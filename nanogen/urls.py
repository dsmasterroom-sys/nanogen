from django.urls import path
from . import views
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('', views.index, name='index'),
    path('api/workflow/store', views.workflow_store_view, name='workflow_store'),
    path('api/generate', views.generate_image_view, name='generate_image'),
    path('api/generate-video', views.generate_video_view, name='generate_video'),
    path('api/images', views.list_images, name='list_images'),
    path('api/images/<int:image_id>/delete', views.delete_image, name='delete_image'),
    path('api/library/<str:item_key>/delete', views.delete_library_item, name='delete_library_item'),
    
    # Source Library
    path('api/source', views.list_source_images, name='list_source_images'),
    path('api/source/upload', views.upload_source_image, name='upload_source_image'),
    path('api/source/<int:image_id>/delete', views.delete_source_image, name='delete_source_image'),
    
    # Prompt Gen
    path('api/prompt/midjourney', views.generate_midjourney_prompt_view, name='generate_midjourney_prompt'),
    path('api/prompt/presets', views.get_midjourney_presets, name='get_midjourney_presets'),
    
    # Prompt Gen Edit API
    path('api/prompt/option/add', views.add_midjourney_option, name='add_midjourney_option'),
    path('api/prompt/option/<int:option_id>/edit', views.edit_midjourney_option, name='edit_midjourney_option'),
    path('api/prompt/option/<int:option_id>/delete', views.delete_midjourney_option, name='delete_midjourney_option'),
    path('api/prompt/option/reset', views.reset_midjourney_options, name='reset_midjourney_options'),

    path('favicon.ico', views.favicon_view),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
