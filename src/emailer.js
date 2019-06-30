/*
 *
 */
const SES = require('aws-sdk/clients/ses');

const utils = require('./utils');
const config = require('./config');

const { definedKeys } = utils;

const {
  sourceAddress,
  registerationTemplate,
  resetPasswordTemplate,
  changeEmailTemplate,
  invitationTemplate,
  registrationURL,
  resetPasswordURL,
  changeEmailURL,
  invitationURL,
} = config.emailer;

const { devTestMode, devDestOverride } = config.emailer;

const ses = new SES({
  apiVersion: '2010-12-01',
  ...definedKeys(config.ses),
});

function fillTemplateINT(string, data) {
  let s = string;
  Object.keys(data).forEach(d => {
    s = s.replace(new RegExp(`\\\${${d}}`, 'g'), data[d]);
  });
  return s;
}

function createUrlINT(templateURL, data, params) {
  const url = new URL(fillTemplateINT(templateURL, { id: data.id }));
  const sp = new URLSearchParams();
  Object.keys(params).forEach(p => {
    sp.append(p, params[p]);
  });
  url.search = sp.toString();

  return url.toString();
}

function createTemplatesINT() {
  return {
    registration: {
      name: data => fillTemplateINT(registerationTemplate, data),
      parameters: data =>
        JSON.stringify({
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          url: createUrlINT(registrationURL, data, {
            email: data.email,
            lang: data.language,
          }),
        }),
    },
    resetPassword: {
      name: data => fillTemplateINT(resetPasswordTemplate, data),
      parameters: data =>
        JSON.stringify({
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          url: createUrlINT(resetPasswordURL, data, {
            email: data.email,
            lang: data.language,
          }),
        }),
    },
    changeEmail: {
      name: data => fillTemplateINT(changeEmailTemplate, data),
      parameters: data =>
        JSON.stringify({
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          url: createUrlINT(changeEmailURL, data, {
            email: data.email,
            lang: data.language,
          }),
        }),
    },
    invitation: {
      name: data => fillTemplateINT(invitationTemplate, data),
      parameters: data =>
        JSON.stringify({
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          url: createUrlINT(invitationURL, data, {
            lang: data.language,
          }),
        }),
    },
  };
}

const templates = createTemplatesINT();

function sendTemplatedINT(type, data) {
  const { email } = data;
  const { name, parameters } = templates[type];

  const params = {
    Destination: {
      ToAddresses: [email],
    },
    Source: sourceAddress,
    Template: name(data),
    TemplateData: parameters(data),
  };

  if (process.env.NODE_ENV !== 'production') {
    if (devTestMode) {
      return Promise.resolve();
    }
    if (devDestOverride) {
      params.Destination.ToAddresses[0] = devDestOverride;
    }
  }

  return new Promise((resolve, reject) => {
    ses.sendTemplatedEmail(params, (err, d) => {
      if (err) return reject(err);
      return resolve(d);
    });
  });
}

function registration(data) {
  return sendTemplatedINT('registration', data);
}

async function resetPassword(data) {
  return sendTemplatedINT('resetPassword', data);
}

async function changeEmail(data) {
  return sendTemplatedINT('changeEmail', data);
}

async function invitation(data) {
  return sendTemplatedINT('invitation', { ...data, language: 'en' });
}

module.exports = {
  registration,
  resetPassword,
  changeEmail,
  invitation,
};
