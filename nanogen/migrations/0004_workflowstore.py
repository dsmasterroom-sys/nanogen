from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('nanogen', '0003_midjourneyoption'),
    ]

    operations = [
        migrations.CreateModel(
            name='WorkflowStore',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key', models.CharField(default='default', max_length=64, unique=True)),
                ('data', models.JSONField(default=dict)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
    ]

