/*
 *
 */
const utils = require('./utils');

const secretsPath = process.env.POSTCARD_SECRETS_PATH || '/run/secrets';

function secretString(k) {
  return utils.fileString(`${secretsPath}/${k}`);
}

const config = {
  redis: {
    host: process.env.POSTCARD_REDIS_HOST,
    port: utils.envInt('POSTCARD_REDIS_PORT'),
  },
  postgres: {
    password: secretString('POSTCARD_POSTGRES_PASSWORD'),
    host: process.env.POSTCARD_POSTGRES_HOST,
    port: utils.envInt('POSTCARD_POSTGRES_PORT'),
    database: process.env.POSTCARD_POSTGRES_DB,
    user: process.env.POSTCARD_POSTGRES_USER,
  },
  minio: {
    accessKey: secretString('POSTCARD_S3_ACCESS_KEY'),
    secretKey: secretString('POSTCARD_S3_SECRET_ACCESS_KEY'),
    useSSL: utils.envBool('POSTCARD_S3_USE_SSL'),
    region: process.env.POSTCARD_S3_REGION,
    endPoint: process.env.POSTCARD_S3_ENDPOINT,
    port: utils.envInt('POSTCARD_S3_PORT'),
  },
  filestore: {
    uploadBucket: process.env.POSTCARD_FILESTORE_UPLOAD_BUCKET,
    imageBucket: process.env.POSTCARD_FILESTORE_IMAGE_BUCKET,
    devPublicHost: process.env.POSTCARD_FILESTORE_DEV_PUBLIC_HOST,
  },
  ses: {
    accessKeyId: secretString('POSTCARD_SES_ACCESS_KEY'),
    secretAccessKey: secretString('POSTCARD_SES_SECRET_ACCESS_KEY'),
    region: process.env.POSTCARD_SES_REGION,
    endpoint: process.env.POSTCARD_SES_ENDPOINT,
  },
  emailer: {
    sourceAddress: process.env.POSTCARD_EMAILER_SOURCE_ADDRESS,
    registerationTemplate: process.env.POSTCARD_EMAILER_REGISTRATION_TEMPLATE,
    resetPasswordTemplate: process.env.POSTCARD_EMAILER_RESET_PASSWORD_TEMPLATE,
    changeEmailTemplate: process.env.POSTCARD_EMAILER_CHANGE_EMAIL_TEMPLATE,
    invitationTemplate: process.env.POSTCARD_EMAILER_INVITATION_TEMPLATE,
    registrationURL: process.env.POSTCARD_EMAILER_REGISTRATION_URL,
    resetPasswordURL: process.env.POSTCARD_EMAILER_RESET_PASSWORD_URL,
    changeEmailURL: process.env.POSTCARD_EMAILER_CHANGE_EMAIL_URL,
    invitationURL: process.env.POSTCARD_EMAILER_INVITATION_URL,
    devTestMode: utils.envBool('POSTCARD_EMAILER_DEV_TESTMODE'),
    devDestOverride: process.env.POSTCARD_EMAILER_DEV_DEST_OVERRIDE,
  },
  // ****************************************************************
  apiPort: utils.envInt('POSTCARD_API_PORT') || 8080,
  wssPort: utils.envInt('POSTCARD_WSS_PORT') || 8080,
  // ****************************************************************
  reconnectionDelayMillis:
    utils.envInt('POSTCARD_RECONNECTION_DELAY_MILLIS') || 1000,
  sessionTag: process.env.POSTCARD_SESSION_TAG || 'POSTCARD_SESSION',
  requestTag: process.env.POSTCARD_REQUEST_TAG || 'POSTCARD_REQUEST',
  sessionTtlMillis:
    utils.envInt('POSTCARD_SESSION_TTL_MILLIS') || 1000 * 60 * 60,
  requestTtlMillis:
    utils.envInt('POSTCARD_REQUEST_TTL_MILLIS') || 1000 * 60 * 60,
  queryLimit: utils.envInt('POSTCARD_QUERY_LIMIT') || 100,
  saltRounds: utils.envInt('POSTCARD_SALT_ROUNDS') || 8,
  eventsChannel: process.env.POSTCARD_EVENTS_CHANNEL || 'POSTCARD_EVENTS',
  pingIntervalMillis:
    utils.envInt('POSTCARD_PING_INTERVAL_MILLIS') || 1000 * 60 * 2,
};

module.exports = config;
