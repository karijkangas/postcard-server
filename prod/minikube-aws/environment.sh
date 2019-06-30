NODE_ENV=production

POSTCARD_REDIS_HOST=postcard-redis
POSTCARD_REDIS_PORT=6379

POSTCARD_POSTGRES_HOST=postcard-postgres
POSTCARD_POSTGRES_PORT=5432
POSTCARD_POSTGRES_DB=postgres
POSTCARD_POSTGRES_USER=postgres

POSTCARD_S3_REGION=eu-west-1
POSTCARD_S3_ENDPOINT=s3.eu-west-1.amazonaws.com
# POSTCARD_S3_PORT=9000
POSTCARD_S3_USE_SSL=true
POSTCARD_S3_UPLOAD_BUCKET=karijkangas-postcard-staging-uploads
POSTCARD_S3_IMAGE_BUCKET=karijkangas-postcard-staging-images
# POSTCARD_DEV_PUBLIC_S3_ENDPOINT=minikube

POSTCARD_SES_REGION=eu-west-1
# POSTCARD_SES_ENDPOINT=
POSTCARD_SES_SOURCE=karijkangas@gmail.com
POSTCARD_SES_REGISTRATION_TEMPLATE=postcard-registration-${language}
POSTCARD_SES_RESET_PASSWORD_TEMPLATE=postcard-reset-password-${language}
POSTCARD_SES_CHANGE_EMAIL_TEMPLATE=postcard-change-email-${language}
POSTCARD_SES_INVITATION_TEMPLATE=postcard-invitation-${language}
POSTCARD_REGISTRATION_URL=http://localhost:3000/register/${id}
POSTCARD_RESET_PASSWORD_URL=http://localhost:3000/reset-password/${id}
POSTCARD_CHANGE_EMAIL_URL=http://localhost:3000/change-email/${id}
POSTCARD_INVITATION_URL=http://localhost:3000/invite/${id}
# POSTCARD_DEV_SES_TESTMODE=true
# POSTCARD_DEV_SES_DESTINATION_OVERRIDE=success@simulator.amazonses.com