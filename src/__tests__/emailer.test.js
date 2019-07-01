/*
 *
 */
/* eslint-disable global-require */
/* eslint-disable no-template-curly-in-string */

jest.setMock('aws-sdk/clients/ses', require('../__mocks__/ses'));

jest.mock('../config');
jest.mock('../logger');

let ses;

let config;
let logger; /* eslint-disable-line */

let emailer;

describe('emailer.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();

    const SES = require('aws-sdk/clients/ses');
    ses = new SES();
    expect(ses.sendTemplatedEmail).toBeDefined();

    config = require('../config');
    config.ses = {
      accessKeyId: 'accessKeyId',
      secretAccessKey: 'secretAccessKey',
      region: 'region',
      endpoint: 'endpoint',
    };
    config.emailer = {
      sourceAddress: 'sourceAddress',
      registerationTemplate: 'registrationTemplate_${language}',
      resetPasswordTemplate: 'resetPasswordTemplate_${language}',
      changeEmailTemplate: 'changeEmailTemplate_${language}',
      invitationTemplate: 'invitationTemplate_${language}',
      registrationURL: 'http://example.com/registration/${id}',
      resetPasswordURL: 'http://example.com/reset-password/${id}',
      changeEmailURL: 'http://example.com/change-email/${id}',
      invitationURL: 'http://example.com/invitation/${id}',
      devTestMode: false,
      devDestinationOverride: false,
    };
    logger = require('../logger');
  });

  test('registration should work', async () => {
    const data = {
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Random',
      language: 'language',
      id: 'id',
    };
    process.env.NODE_ENV = 'production';
    ses.sendTemplatedEmail.mockImplementation((params, cb) => {
      cb();
    });
    emailer = require('../emailer');
    await emailer.registration(data);

    expect(ses.sendTemplatedEmail).toBeCalledTimes(1);
  });
  test('resetPassword should work', async () => {
    const data = {
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Random',
      language: 'language',
      id: 'id',
    };
    process.env.NODE_ENV = 'production';
    ses.sendTemplatedEmail.mockImplementation((params, cb) => {
      cb();
    });
    emailer = require('../emailer');
    await emailer.resetPassword(data);
  });
  test('changeEmail should work', async () => {
    const data = {
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Random',
      language: 'language',
      id: 'id',
    };
    process.env.NODE_ENV = 'production';
    ses.sendTemplatedEmail.mockImplementation((params, cb) => {
      cb();
    });
    emailer = require('../emailer');
    await emailer.changeEmail(data);
  });
  test('invitation should work', async () => {
    const data = {
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Random',
      language: 'language',
      id: 'id',
    };
    process.env.NODE_ENV = 'production';
    ses.sendTemplatedEmail.mockImplementation((params, cb) => {
      cb();
    });
    emailer = require('../emailer');
    await emailer.invitation(data);
  });

  test('failure to send email should throw', async () => {
    const data = {
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Random',
      language: 'language',
      id: 'id',
    };
    process.env.NODE_ENV = 'production';
    ses.sendTemplatedEmail.mockImplementation((params, cb) => {
      cb(new Error('TEST'));
    });
    emailer = require('../emailer');
    await expect(emailer.registration(data)).rejects.toThrow('TEST');

    expect(ses.sendTemplatedEmail).toBeCalledTimes(1);
  });

  test('development mode should work', async () => {
    const data = {
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Random',
      language: 'language',
      id: 'id',
    };
    process.env.NODE_ENV = 'test';
    ses.sendTemplatedEmail.mockImplementation((params, cb) => {
      cb();
    });
    emailer = require('../emailer');
    await emailer.registration(data);

    expect(ses.sendTemplatedEmail).toBeCalledTimes(1);
  });

  test('devTestMode should work', async () => {
    const data = {
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Random',
      language: 'language',
      id: 'id',
    };

    process.env.NODE_ENV = 'test';
    config.emailer.devTestMode = true;
    ses.sendTemplatedEmail.mockImplementation((params, cb) => {
      cb();
    });
    emailer = require('../emailer');
    await emailer.registration(data);
    expect(ses.sendTemplatedEmail).not.toBeCalled();
  });
  test('devDestOverride should work', async () => {
    const data = {
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Random',
      language: 'language',
      id: 'id',
    };

    process.env.NODE_ENV = 'test';
    config.emailer.devDestOverride = 'override';
    ses.sendTemplatedEmail.mockImplementation((params, cb) => {
      cb();
    });
    emailer = require('../emailer');
    await emailer.registration(data);
    expect(ses.sendTemplatedEmail).toBeCalledTimes(1);
    expect(
      ses.sendTemplatedEmail.mock.calls[0][0].Destination.ToAddresses[0]
    ).toEqual(config.emailer.devDestOverride);
  });
});
