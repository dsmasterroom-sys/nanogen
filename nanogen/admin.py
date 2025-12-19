from django.contrib import admin
from .models import GeneratedImage, SourceImage, MidjourneyOption

# Register your models here.
admin.site.register(GeneratedImage)
admin.site.register(SourceImage)

@admin.register(MidjourneyOption)
class MidjourneyOptionAdmin(admin.ModelAdmin):
    list_display = ('category', 'label', 'value', 'order')
    list_filter = ('category',)
    search_fields = ('label', 'value')
    ordering = ('category', 'order', 'label')
