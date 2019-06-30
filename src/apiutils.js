/*
 *
 */
const bcrypt = require('bcryptjs');
const emailValidator = require('email-validator');
const PasswordValidator = require('password-validator');

const sesstore = require('./sesstore');
const publisher = require('./publisher');
const config = require('./config');

const passwordValidator = new PasswordValidator().is().min(8);

function sendReply(res, status = 204, data) {
  res.status(status).json(data);
}

function sendError(res, status, error) {
  res.status(status).json({ error });
}

async function getSession(authString) {
  if (authString) {
    const m = authString.match(/^POSTCARD-TOKEN\s+token="([^"]*)"/);
    if (m) {
      const token = m[1];
      const data = await sesstore.sessionData({ token });
      if (data) {
        return { token, data };
      }
    }
  }
  return undefined;
}

const asyncmw = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const sesmw = async (req, res, next) => {
  try {
    req.session = await getSession(req.get('Authorization'));
    if (req.session) {
      return next();
    }
    return sendError(res, 403, 'Invalid session');
  } catch (e) {
    return next(e);
  }
};

function validateName(name) {
  return (
    (name && typeof name === 'string' && name.trim().length >= 1 && name) ||
    undefined
  );
}

function validateEmail(email) {
  return (email && emailValidator.validate(email) && email) || undefined;
}

function validatePassword(password) {
  return (
    (password &&
      typeof password === 'string' &&
      passwordValidator.validate(password) &&
      password) ||
    undefined
  );
}

function validateLanguage(language) {
  return (['en', 'fi'].includes(language) && language) || undefined;
}

async function hashPassword(password) {
  const salt =
    (password && (await bcrypt.genSalt(config.saltRounds))) || undefined;
  return (password && bcrypt.hash(password, salt)) || undefined;
}

async function comparePassword(password, passhash) {
  return (password && passhash && bcrypt.compare(password, passhash)) || false;
}

function reqSession(req) {
  return (req && req.session) || undefined;
}

function reqUser(req) {
  return (req && req.session && req.session.data) || undefined;
}

function endSession(req) {
  publisher.logout(reqUser(req)).catch(() => {});
  return sesstore.endSession(reqSession(req));
}

module.exports = {
  asyncmw,
  comparePassword,
  endSession,
  hashPassword,
  reqSession,
  reqUser,
  sendError,
  sendReply,
  sesmw,
  validateEmail,
  validateLanguage,
  validateName,
  validatePassword,
};
