import json
import tempfile
from datetime import timedelta
from pathlib import Path

from django.contrib.auth.models import Permission, User
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from pythonsupport.urls import FRONTEND_DIR

from .models import SatisfactionSurveyResponse, SurveyLink, SupporterProblemLog
from .views import SatisfactionSurveyResponseForm

PASSWORD = 'hunter2'

VALID = {
    'student_number': 's123456', 'satisfaction': 5,
    'course_number': '02525 - Introduction to Mathematics and Technology',
    'building_number': '358', 'workshop': False, 'used_ai': True,
}


def without(key):
    return {k: v for k, v in VALID.items() if k != key}


@override_settings(SURVEY_PASSWORD=PASSWORD)
class SubmitResponseTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.token = self.get_token(self.client, PASSWORD).json()['csrfToken']

    def get_token(self, client, password):
        return client.post('/api/csrf/', {'password': password}, content_type='application/json')

    def post(self, data, client=None, token=None):
        return (client or self.client).post(
            '/api/responses/', data, content_type='application/json',
            headers={'X-CSRFToken': token or self.token},
        )

    def test_submission_needs_password_and_token(self):
        stranger = Client(enforce_csrf_checks=True)
        self.assertEqual(self.get_token(stranger, 'wrong').status_code, 403)
        # A self-made cookie/header pair passes Django's CSRF check on its own.
        stranger.cookies['csrftoken'] = 'a' * 32
        response = self.post(VALID, stranger, 'a' * 32)
        self.assertEqual(response.status_code, 403)
        self.assertIn('password', response.json()['error'])  # our gate, not CsrfViewMiddleware
        # Right session, missing token.
        self.assertEqual(self.client.post('/api/responses/', VALID, content_type='application/json').status_code, 403)
        self.assertFalse(SatisfactionSurveyResponse.objects.exists())

    def test_one_time_link(self):
        stranger = Client(enforce_csrf_checks=True)
        stranger.cookies['csrftoken'] = 'a' * 32
        self.assertEqual(stranger.post('/api/links/', headers={'X-CSRFToken': 'a' * 32}).status_code, 403)
        token = self.client.post('/api/links/', headers={'X-CSRFToken': self.token}).json()['token']

        student = Client(enforce_csrf_checks=True)  # no session, no CSRF token
        def use(data, token=token):
            return student.post('/api/responses/', {**data, 'token': token}, content_type='application/json')
        self.assertEqual(use({'ping': True}).status_code, 200)
        self.assertEqual(use(without('satisfaction')).status_code, 400)  # does not use the link up
        self.assertEqual(use({**VALID, 'building_number': None}).status_code, 201)
        self.assertEqual(SatisfactionSurveyResponse.objects.get().building_number, 'Online')
        self.assertEqual(use(VALID).status_code, 403)
        self.assertEqual(use({'ping': True}).status_code, 403)

        SurveyLink.objects.create(token='old', building_number='Online', single_use=True, expires_at=timezone.now())
        self.assertIn('expired', use(VALID, 'old').json()['error'])
        self.assertEqual(SatisfactionSurveyResponse.objects.count(), 1)

    def test_qr_code(self):
        def issue(data, client=self.client, csrf_token=self.token):
            return client.post('/api/qr-codes/', data, content_type='application/json', headers={'X-CSRFToken': csrf_token})
        stranger = Client(enforce_csrf_checks=True)
        stranger.cookies['csrftoken'] = 'a' * 32
        self.assertEqual(issue({'building_number': 358, 'valid_days': 7}, stranger, 'a' * 32).status_code, 403)
        self.assertIn('valid_days', issue({'building_number': 358, 'valid_days': 0}).json()['errors'])
        for building in [100, 500]:  # DTU Lyngby numbers only: 101-499
            self.assertIn('building_number', issue({'building_number': building, 'valid_days': 7}).json()['errors'])

        issued = issue({'building_number': 358, 'valid_days': 7}).json()
        token = issued['token']
        self.assertEqual(issued['url'], f'http://testserver/?t={token}')
        self.assertTrue(issued['qr'].startswith('data:image/png;base64,'))
        workshop = issue({'building_number': 358, 'valid_days': 7, 'workshop_day': True}).json()
        self.assertEqual(workshop['url'], f"http://testserver/?t={workshop['token']}&wd=1")
        link = SurveyLink.objects.get(token=token)
        self.assertAlmostEqual(link.expires_at, timezone.now() + timedelta(days=7), delta=timedelta(minutes=1))

        student = Client(enforce_csrf_checks=True)  # no session, no CSRF token
        def use():
            data = {**VALID, 'building_number': None, 'token': token}
            return student.post('/api/responses/', data, content_type='application/json')
        self.assertEqual(use().status_code, 201)
        self.assertEqual(use().status_code, 201)  # a QR code is not used up
        self.assertEqual(set(SatisfactionSurveyResponse.objects.values_list('building_number', flat=True)), {'358'})
        link.expires_at = timezone.now()
        link.save()
        self.assertEqual(use().status_code, 403)

    def test_valid_submission_is_saved(self):
        response = self.post(VALID)
        self.assertEqual(response.status_code, 201)
        saved = SatisfactionSurveyResponse.objects.get()
        self.assertEqual(response.json()['id'], saved.pk)
        self.assertIs(saved.workshop, False)
        # The frontend sends null for the optional course and AI questions when left empty.
        response = self.post({**VALID, 'course_number': None, 'used_ai': None})
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(SatisfactionSurveyResponse.objects.get(pk=response.json()['id']).used_ai)

    def test_queued_response_keeps_the_time_it_was_saved(self):
        now = timezone.now()
        five_hours_ago = (now - timedelta(hours=5)).replace(microsecond=123000)
        for saved_at, expected in [
            (five_hours_ago.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z', five_hours_ago),  # as toISOString() writes it
            ((now + timedelta(hours=1)).isoformat(), None),  # device clock ahead: upload time
            ((now - timedelta(days=8)).isoformat(), None),   # too old to trust: upload time
        ]:
            response = self.post({**VALID, 'saved_at': saved_at})
            self.assertEqual(response.status_code, 201, saved_at)
            created_at = SatisfactionSurveyResponse.objects.get(pk=response.json()['id']).created_at
            if expected:
                self.assertEqual(created_at, expected)
            else:
                self.assertGreaterEqual(created_at, now)

    def test_link_submission_ignores_saved_at(self):
        link = SurveyLink.objects.create(
            token='qr', building_number='358', single_use=False, expires_at=timezone.now() + timedelta(days=1),
        )
        now = timezone.now()
        data = {**VALID, 'token': link.token, 'saved_at': (now - timedelta(days=2)).isoformat()}
        response = Client().post('/api/responses/', data, content_type='application/json')
        self.assertEqual(response.status_code, 201)
        self.assertGreaterEqual(SatisfactionSurveyResponse.objects.get().created_at, now)

    def test_bad_payloads_are_rejected(self):
        for field, data in [
            ('workshop', without('workshop')),
            ('course_number', {**VALID, 'course_number': 'fysik'}),
            ('saved_at', {**VALID, 'saved_at': 'yesterday'}),
            ('satisfaction', {**VALID, 'satisfaction': 11}),
            ('building_number', {**VALID, 'building_number': '100'}),
            ('building_number', {**VALID, 'building_number': '500'}),
            ('building_number', {**VALID, 'building_number': 'abc'}),
            ('student_number', {**VALID, 'student_number': '1234567'}),
            ('student_number', {**VALID, 'student_number': 'S123456'}),
            ('student_number', {**VALID, 'student_number': 's12345'}),
            ('username', {**without('student_number'), 'username': 'TJOH'}),
            ('__all__', without('student_number')),
            ('__all__', {**VALID, 'username': 'tjoh'}),
        ]:
            response = self.post(data)
            self.assertEqual(response.status_code, 400, field)
            self.assertIn(field, response.json()['errors'])
        self.assertFalse(SatisfactionSurveyResponse.objects.exists())

    @override_settings(SURVEY_PASSWORD='')
    def test_empty_password_setting_never_logs_in(self):
        for password in ['', 'x']:
            self.assertEqual(self.get_token(Client(), password).status_code, 403, repr(password))

    def test_non_json_body_is_rejected(self):
        for url in ['/api/responses/', '/api/qr-codes/', '/api/problem-logs/']:
            response = self.client.post(url, 'not json', content_type='application/json',
                                        headers={'X-CSRFToken': self.token})
            self.assertEqual(response.status_code, 400, url)

    def test_issuing_a_link_purges_expired_ones(self):
        SurveyLink.objects.create(token='old', building_number='358', single_use=False, expires_at=timezone.now())
        self.assertEqual(self.client.post('/api/links/', headers={'X-CSRFToken': self.token}).status_code, 201)
        self.assertFalse(SurveyLink.objects.filter(token='old').exists())

    def test_every_course_the_form_offers_is_accepted(self):
        courses = json.loads((FRONTEND_DIR / 'data' / 'courses.json').read_text())
        labels = [f"{c['number']} - {c['name']}" for c in courses]  # as survey.js builds them
        rejected = [label for label in labels
                    if not SatisfactionSurveyResponseForm({**VALID, 'course_number': label}).is_valid()]
        self.assertEqual(rejected, [])


@override_settings(SURVEY_PASSWORD=PASSWORD)
class SupporterProblemLogTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        response = self.client.post(
            '/api/csrf/', {'password': PASSWORD}, content_type='application/json',
        )
        self.token = response.json()['csrfToken']

    def post(self, data, client=None, token=None):
        return (client or self.client).post(
            '/api/problem-logs/', data, content_type='application/json',
            headers={'X-CSRFToken': token or self.token},
        )

    def test_submission_needs_supporter_session_and_csrf_token(self):
        stranger = Client(enforce_csrf_checks=True)
        stranger.cookies['csrftoken'] = 'a' * 32
        response = self.post({'problems': ['Antivirus']}, stranger, 'a' * 32)
        self.assertEqual(response.status_code, 403)
        self.assertIn('password', response.json()['error'])
        self.assertEqual(
            self.client.post(
                '/api/problem-logs/', {'problems': ['Antivirus']},
                content_type='application/json',
            ).status_code,
            403,
        )
        self.assertFalse(SupporterProblemLog.objects.exists())

    def test_selected_problems_and_note_are_saved(self):
        response = self.post({
            'problems': ['Files and Folders', 'MS Start App'],
            'other': '  Conda environment was not activated.  ',
        })
        self.assertEqual(response.status_code, 201)
        saved = SupporterProblemLog.objects.get()
        self.assertEqual(response.json()['id'], saved.pk)
        self.assertIs(saved.files_and_folders, True)
        self.assertIs(saved.ms_start_app, True)
        self.assertIs(saved.antivirus, False)
        self.assertEqual(saved.other, 'Conda environment was not activated.')

    def test_other_text_can_be_submitted_by_itself(self):
        self.assertEqual(self.post({'other': 'A new problem'}).status_code, 201)
        saved = SupporterProblemLog.objects.get()
        self.assertEqual(saved.other, 'A new problem')
        self.assertIs(saved.starting_idle, False)

    def test_empty_or_unknown_problem_is_rejected(self):
        for data in [
            {},
            {'problems': [], 'other': '   '},
            {'problems': ['Not a real option']},
            {'problems': 'Antivirus'},
            {'problems': [], 'other': ['not', 'text']},
        ]:
            self.assertEqual(self.post(data).status_code, 400, data)
        self.assertFalse(SupporterProblemLog.objects.exists())


class FrontendTests(TestCase):
    def test_browsers_revalidate_every_load(self):
        for url in ('/', '/js/app.js'):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Cache-Control'], 'no-cache')
            response.close()
        modified = self.client.get('/js/app.js')['Last-Modified']
        self.assertEqual(self.client.get('/js/app.js', HTTP_IF_MODIFIED_SINCE=modified).status_code, 304)

    def test_admin_without_trailing_slash_redirects(self):
        self.assertRedirects(self.client.get('/admin'), '/admin/', 301, fetch_redirect_response=False)
        self.assertEqual(self.client.get('/no-such-page').status_code, 404)


class DashboardTests(TestCase):
    def setUp(self):
        self.page = Path(self.enterContext(tempfile.TemporaryDirectory())) / 'dashboard.html'
        self.page.write_text('<p>charts</p>')
        self.enterContext(override_settings(DASHBOARD_HTML=self.page))

    def log_in(self, *permissions):
        user = User.objects.create_user('analyst', is_staff=True)
        user.user_permissions.set(Permission.objects.filter(codename__in=permissions))
        self.client.force_login(user)

    def test_needs_admin_login_and_view_permission(self):
        self.assertRedirects(self.client.get('/admin/dashboard/'), '/admin/login/?next=/admin/dashboard/')
        self.log_in()
        self.assertEqual(self.client.get('/admin/dashboard/').status_code, 403)
        self.assertNotContains(self.client.get('/admin/'), '/admin/dashboard/')

    def test_serves_the_page_sandboxed(self):
        self.log_in('view_satisfactionsurveyresponse')
        self.assertContains(self.client.get('/admin/'), '/admin/dashboard/')
        response = self.client.get('/admin/dashboard/')
        self.assertEqual(b''.join(response.streaming_content), b'<p>charts</p>')
        self.assertIn('sandbox allow-scripts allow-downloads;', response['Content-Security-Policy'])
        self.assertIn("default-src 'none'", response['Content-Security-Policy'])
        self.page.unlink()
        self.assertEqual(self.client.get('/admin/dashboard/').status_code, 404)
