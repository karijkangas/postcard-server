/*
 *
 */
/* eslint-disable no-use-before-define, no-console */
process.env.AWS_SDK_LOAD_CONFIG = 'true';

const sqs = require('./sqs');

sqs.initialize({
  URL: 'https://sqs.eu-west-1.amazonaws.com/521453527975/postcard-testing',
});

(async () => {
  try {
    const r = await sqs.pollRequestId();
    if (r) {
      console.log(r.email, r.id);
      process.exit(0);
    }
  } catch (e) {
    console.log(`Exception: ${e}`);
  }
  process.exit(1);
})();
