from django.conf import settings
from django.contrib import admin
from django.urls import path, re_path
from django.views.decorators.cache import cache_control
from django.views.static import serve

from survey import views

FRONTEND_DIR = settings.BASE_DIR.parent.parent / 'frontend'
# Browsers ask for a newer copy on every load (a 304 when unchanged), so devices never run stale JS.
serve_frontend = cache_control(no_cache=True)(serve)

urlpatterns = [
    # Before admin/, which would answer it with a 404.
    path('admin/dashboard/', admin.site.admin_view(views.dashboard), name='dashboard'),
    path('admin/', admin.site.urls),
    path('api/csrf/', views.request_csrf_token),
    path('api/responses/', views.submit_response),
    path('api/problem-logs/', views.submit_supporter_problem),
    path('api/links/', views.issue_link),
    path('api/qr-codes/', views.issue_qr_code),
    # nginx forwards every request here, so Django serves static files and the frontend itself.
    # ponytail: django's serve() is slow; add WhiteNoise if traffic grows.
    re_path(r'^static/(?P<path>.*)$', serve, {'document_root': settings.STATIC_ROOT}),
    # Frontend last, so the API and admin routes win.
    path('', serve_frontend, {'document_root': FRONTEND_DIR, 'path': 'index.html'}),
    # Files only (every frontend file has an extension), so Django can add a missing slash to /admin.
    re_path(r'^(?P<path>.+\.\w+)$', serve_frontend, {'document_root': FRONTEND_DIR}),
]
