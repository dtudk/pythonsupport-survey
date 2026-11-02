import json
import secrets
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlencode

import segno
from django import forms
from django.conf import settings
from django.contrib.auth.decorators import permission_required
from django.db import transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from django.views.decorators.csrf import csrf_exempt, csrf_protect
from django.views.decorators.http import require_POST
from django.views.static import serve

from .models import SatisfactionSurveyResponse, SupporterProblemLog, SurveyLink

ONE_TIME_LINK_LIFETIME = timedelta(hours=24)
SAVED_AT_MAX_AGE = timedelta(days=7)
ONE_TIME_LINK_BUILDING = 'Online'
NEED_PASSWORD = "Request a CSRF token with the survey password first."
LINK_GONE = "This link has expired or was already used."
PROBLEM_FIELDS = {
    'Files and Folders': 'files_and_folders',
    'Trust issues VS Code': 'trust_issues_vs_code',
    'MS Powershell / Mini Forge Prompt': 'ms_powershell_mini_forge_prompt',
    'Starting Idle': 'starting_idle',
    'MS Start App': 'ms_start_app',
    'Antivirus': 'antivirus',
}


class SatisfactionSurveyResponseForm(forms.ModelForm):
    # When a device queued the response offline (failsafe.js).
    saved_at = forms.DateTimeField(required=False)

    class Meta:
        model = SatisfactionSurveyResponse
        fields = [
            'student_number', 'username', 'satisfaction', 'course_number',
            'building_number', 'workshop', 'used_ai',
        ]

    def clean(self):
        # A missing checkbox means False to Django; for an API it means a forgotten answer.
        if 'workshop' not in self.data:
            self.add_error('workshop', "This field is required.")
        cleaned = super().clean()
        # The device's clock: ignored if it is ahead of ours or the response is too old to trust.
        saved_at, now = cleaned.get('saved_at'), timezone.now()
        if saved_at and now - SAVED_AT_MAX_AGE <= saved_at <= now:
            self.instance.created_at = saved_at
        return cleaned

class SupporterProblemLogForm(forms.ModelForm):
    class Meta:
        model = SupporterProblemLog
        fields = [*PROBLEM_FIELDS.values(), 'other']

    def clean(self):
        cleaned = super().clean()
        cleaned['other'] = (cleaned.get('other') or '').strip()
        if not cleaned['other'] and not any(cleaned.get(field) for field in PROBLEM_FIELDS.values()):
            raise forms.ValidationError("Select at least one problem or describe another problem.")
        return cleaned


class QrCodeForm(forms.Form):
    building_number = forms.IntegerField(min_value=101, max_value=499)  # as building_number_format
    valid_days = forms.IntegerField(min_value=1, max_value=365)
    workshop_day = forms.BooleanField(required=False)


def read_json_object(request):
    """The request body as a dict, or None when it is not a JSON object."""
    try:
        payload = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None

# Exempt: the caller has no token yet.
@csrf_exempt
@require_POST
def request_csrf_token(request):
    password = (read_json_object(request) or {}).get('password')
    expected = settings.SURVEY_PASSWORD
    if not (expected and password and constant_time_compare(password, expected)):
        return JsonResponse({'error': "Wrong password."}, status=403)

    request.session.cycle_key()
    # Django never checks who issued a CSRF cookie, so the token alone proves nothing.
    request.session['survey_authorized'] = True
    return JsonResponse({'csrfToken': get_token(request)})


@require_POST
def issue_link(request):
    if not request.session.get('survey_authorized'):
        return JsonResponse({'error': NEED_PASSWORD}, status=403)
    link = create_link(ONE_TIME_LINK_LIFETIME, building_number=ONE_TIME_LINK_BUILDING, single_use=True)
    return JsonResponse({'token': link.token}, status=201)


@require_POST
def issue_qr_code(request):
    if not request.session.get('survey_authorized'):
        return JsonResponse({'error': NEED_PASSWORD}, status=403)
    form = QrCodeForm(read_json_object(request) or {})
    if not form.is_valid():
        return JsonResponse({'errors': form.errors.get_json_data()}, status=400)
    link = create_link(
        timedelta(days=form.cleaned_data['valid_days']),
        building_number=str(form.cleaned_data['building_number']), single_use=False,
    )
    query = {'t': link.token, **({'wd': 1} if form.cleaned_data['workshop_day'] else {})}
    url = request.build_absolute_uri('/?' + urlencode(query))
    # make_qr, not make: never a Micro QR code, which not every phone camera reads.
    qr = segno.make_qr(url, error='m').png_data_uri(scale=8, border=2)
    return JsonResponse({'token': link.token, 'url': url, 'qr': qr}, status=201)


def create_link(lifetime, **fields):
    now = timezone.now()
    SurveyLink.objects.filter(expires_at__lte=now).delete()
    return SurveyLink.objects.create(token=secrets.token_urlsafe(), expires_at=now + lifetime, **fields)


# Exempt: the link token is the student's credential. Sessions are checked in submit_with_session.
@csrf_exempt
@require_POST
def submit_response(request):
    payload = read_json_object(request)
    if payload is None:
        return JsonResponse({'error': "Request body must be a JSON object."}, status=400)
    if payload.get('token'):
        return submit_with_link(payload)
    return submit_with_session(request, payload)


@csrf_protect
def submit_with_session(request, payload):
    if not request.session.get('survey_authorized'):
        return JsonResponse({'error': NEED_PASSWORD}, status=403)
    return save_response(payload)


def submit_with_link(payload):
    link = SurveyLink.objects.filter(token=str(payload['token']), expires_at__gt=timezone.now()).first()
    if link is None:
        return JsonResponse({'error': LINK_GONE}, status=403)
    if payload.get('ping'):  # the survey page checks its link before showing the form
        return JsonResponse({})
    # Students' phones never queue, so only a supporter's device may send when a response was taken.
    data = {**payload, 'building_number': link.building_number, 'saved_at': None}
    return save_response(data, link if link.single_use else None)


def save_response(data, single_use_link=None):
    form = SatisfactionSurveyResponseForm(data)
    if not form.is_valid():
        return JsonResponse({'errors': form.errors.get_json_data()}, status=400)
    with transaction.atomic():
        # Deleting the link uses it up; of two submits racing on one link, only one deletes it.
        if single_use_link is not None and not single_use_link.delete()[0]:
            return JsonResponse({'error': LINK_GONE}, status=403)
        return JsonResponse({'id': form.save().pk}, status=201)


@require_POST
@csrf_protect
def submit_supporter_problem(request):
    if not request.session.get('survey_authorized'):
        return JsonResponse({'error': NEED_PASSWORD}, status=403)

    payload = read_json_object(request)
    if payload is None:
        return JsonResponse({'error': "Request body must be a JSON object."}, status=400)

    problems = payload.get('problems', [])
    if not isinstance(problems, list) or any(not isinstance(problem, str) for problem in problems):
        return JsonResponse({'errors': {'problems': ['Must be a list of problem names.']}}, status=400)
    unknown = sorted(set(problems) - PROBLEM_FIELDS.keys())
    if unknown:
        return JsonResponse({'errors': {'problems': [f"Unknown problem: {problem}" for problem in unknown]}}, status=400)

    other = payload.get('other', '')
    if not isinstance(other, str):
        return JsonResponse({'errors': {'other': ['Must be text.']}}, status=400)

    selected = set(problems)
    form = SupporterProblemLogForm({
        **{field: label in selected for label, field in PROBLEM_FIELDS.items()},
        'other': other,
    })
    if not form.is_valid():
        return JsonResponse({'errors': form.errors.get_json_data()}, status=400)
    return JsonResponse({'id': form.save().pk}, status=201)


@permission_required('survey.view_satisfactionsurveyresponse', raise_exception=True)
def dashboard(request):
    page = Path(settings.DASHBOARD_HTML)
    response = serve(request, page.name, document_root=page.parent)  # 404 until the pipeline has run
    # A separate origin that can't send its rows anywhere; everything it needs is inline.
    response['Content-Security-Policy'] = (
        "sandbox allow-scripts allow-downloads; default-src 'none'; script-src 'unsafe-inline'; "
        "style-src 'unsafe-inline'; img-src data: blob:; form-action 'none'"
    )
    return response
