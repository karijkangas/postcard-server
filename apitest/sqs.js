/*
 *
 */
const AWS = require('aws-sdk');
const quotedPrintable = require('quoted-printable');

const com = require('./apitest-common');

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const REGEXP = new RegExp(/<a href=["'][^:]+:\/\/[^/]+\/[^/]+\/([^?]+)\?/);

let QueueUrl;

function initialize(options) {
  QueueUrl = options.URL;
}

async function clearQueue(url = QueueUrl) {
  try {
    const params = {
      QueueUrl: url,
    };
    await sqs.purgeQueue(params).promise();
  } catch (e) {
    console.log(`Exception ${e}`);
  }
}

async function getRequestId(url = QueueUrl) {
  try {
    const params = {
      AttributeNames: ['SentTimestamp'],
      MaxNumberOfMessages: 10,
      MessageAttributeNames: ['All'],
      QueueUrl: url,
      VisibilityTimeout: 20,
      WaitTimeSeconds: 10,
    };

    /* eslint-disable-next-line no-constant-condition */
    const data = await sqs.receiveMessage(params).promise();
    if (!data.Messages) {
      // console.log('>>>> NO MESSAGES', data);
      return undefined;
    }

    const deleteParams = {
      QueueUrl: url,
      ReceiptHandle: data.Messages[0].ReceiptHandle,
    };
    await sqs.deleteMessage(deleteParams).promise();

    const message = data.Messages[0];
    const body = JSON.parse(message.Body);
    // console.log(body);
    const m = JSON.parse(body.Message);
    // console.log(m);
    const email = m.mail.destination[0];
    const content = Buffer.from(m.content, 'base64').toString('ascii');
    // console.log(content);
    const text = quotedPrintable.decode(content);
    // console.log(text);

    const match = text.match(REGEXP);
    if (match && match[1]) {
      return { email, id: match[1] };
    }
    // console.log('>>>> NO MATCH', data);
  } catch (e) {
    console.log(`Exception ${e}`);
  }
  return undefined;
}

async function pollRequestId(timeoutMillis = 10000, url = QueueUrl) {
  const until = Date.now() + timeoutMillis;

  while (Date.now() < until) {
    const r = await getRequestId(url);
    if (r) {
      return r;
    }
    await com.sleep(1000);
  }
  // console.log('>>>> TIMEOUT');
  return undefined;
}

module.exports = {
  initialize,
  clearQueue,
  getRequestId,
  pollRequestId,
};
