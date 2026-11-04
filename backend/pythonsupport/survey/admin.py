from django.contrib import admin

from .models import SatisfactionSurveyResponse, SupporterProblemLog, SurveyLink

admin.site.index_template = 'survey/admin_index.html'

@admin.register(SatisfactionSurveyResponse)
class SatisfactionSurveyResponseAdmin(admin.ModelAdmin):
    list_display = [
        'created_at', 'student_number', 'username', 'satisfaction',
        'course_number', 'building_number', 'workshop', 'used_ai',
    ]


@admin.register(SupporterProblemLog)
class SupporterProblemLogAdmin(admin.ModelAdmin):
    list_display = [
        'created_at', 'files_and_folders', 'trust_issues_vs_code',
        'ms_powershell_mini_forge_prompt', 'starting_idle',
        'ms_start_app', 'antivirus', 'other',
    ]


# Deleting a link revokes it: a leaked QR code stops working at once.
@admin.register(SurveyLink)
class SurveyLinkAdmin(admin.ModelAdmin):
    list_display = ['building_number', 'single_use', 'expires_at']
