/*
 *
 */
/* eslint-disable global-require */
jest.mock('bcryptjs');
jest.mock('email-validator');
jest.mock('password-validator');

jest.mock('../database');
jest.mock('../filestore');
jest.mock('../kvstore');
jest.mock('../publisher');
jest.mock('../reqstore');
jest.mock('../emailer');
jest.mock('../sesstore');
jest.mock('../config');
jest.mock('../logger');
jest.mock('../devapi-v1');

let bcrypt;
let emailValidator;
let passwordValidator;

let request;

let config;
let logger;
let database;
let filestore;
let kvstore;
let publisher;
let reqstore;
let emailer;
let sesstore;
let devapi;

let app;

const { resolvePromises } = require('./util');

describe('app.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();

    bcrypt = require('bcryptjs');
    emailValidator = require('email-validator');
    const PasswordValidator = require('password-validator');
    passwordValidator = new PasswordValidator();

    request = require('supertest');

    config = require('../config');
    config.reconnectionDelayMillis = 'reconnectionDelayMillis';
    config.saltRounds = 'saltRounds';
    config.queryLimit = 1234;

    logger = require('../logger');

    database = require('../database');
    filestore = require('../filestore');
    kvstore = require('../kvstore');
    publisher = require('../publisher');
    reqstore = require('../reqstore');
    emailer = require('../emailer');
    sesstore = require('../sesstore');
    devapi = require('../devapi-v1');

    app = require('../app');
  });

  test('App initialize and shutdown should work', async () => {
    const a = await app.initialize();

    expect(a).toBeDefined();
    expect(database.initialize).toBeCalled();
    expect(filestore.initialize).toBeCalled();
    expect(kvstore.initialize).toBeCalled();
    expect(publisher.initialize).toBeCalled();

    await app.shutdown();

    expect(database.shutdown).toBeCalled();
    expect(filestore.shutdown).toBeCalled();
    expect(kvstore.shutdown).toBeCalled();
    expect(publisher.shutdown).toBeCalled();
  });

  test('App initialization should loop until success', async () => {
    database.initialize.mockRejectedValueOnce(new Error('Test'));
    filestore.initialize.mockRejectedValueOnce(new Error('Test'));
    kvstore.initialize.mockRejectedValueOnce(new Error('Test'));
    publisher.initialize.mockRejectedValueOnce(new Error('Test'));

    const ap = app.initialize();
    await resolvePromises();

    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenLastCalledWith(
      expect.any(Function),
      config.reconnectionDelayMillis
    );

    jest.runAllTimers();
    const a = await ap;

    expect(a).toBeDefined();
    expect(database.initialize).toBeCalled();
    expect(filestore.initialize).toBeCalled();
    expect(kvstore.initialize).toBeCalled();
    expect(publisher.initialize).toBeCalled();
  });

  test('App shutdown should ignore errors', async () => {
    database.shutdown.mockRejectedValueOnce(new Error('Test'));
    await app.shutdown();
  });

  test('Devapi should be loaded with NODE_ENV !== production', async () => {
    process.env.NODE_ENV = 'development';
    const a = await app.initialize();
    await request(a).get('/v1/dev');
    expect(devapi).toBeCalled();
  });

  test('Devapi should not be loaded with NODE_ENV === production', async () => {
    process.env.NODE_ENV = 'production';
    const a = await app.initialize();
    await request(a).get('/v1/dev');
    expect(devapi).not.toBeCalled();
  });

  test('App should return 404 error on invalid path', async () => {
    const a = await app.initialize();

    const r = await request(a)
      .get('/v1/missing')
      .set('Accept', 'application/json')
      .expect(404);
    expect(r.body).toEqual({ error: 'Not found' });
  });

  test('App should return 400 error on invalid json', async () => {
    const a = await app.initialize();

    const r = await request(a)
      .post('/v1/registrations')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .send('haxxors')
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(emailValidator.validate).not.toBeCalled();
    expect(passwordValidator.validate).not.toBeCalled();
  });

  test('App should return 500 error on internal service error', async () => {
    const a = await app.initialize();

    emailValidator.validate.mockReturnValue(true);
    database.findUser.mockRejectedValueOnce(new Error('TEST'));
    database.isRegisteredUser.mockReturnValue(false);

    const r = await request(a)
      .get('/v1/registrations/available')
      .query({ email: 'test@example.com' })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });
    expect(logger.error).toBeCalled();

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.findUser).toBeCalledTimes(1);
    expect(database.isRegisteredUser).not.toBeCalled();
  });

  test('GET /v1/healthz should work', async () => {
    const a = await app.initialize();
    await request(a)
      .get('/v1/healthz')
      .set('Accept', 'application/json')
      .expect(204);
  });

  test('GET /v1/registrations/available should work', async () => {
    const a = await app.initialize();
    emailValidator.validate.mockReturnValueOnce(true);
    const email = 'test@example.com';
    const user = {};
    database.findUser.mockResolvedValueOnce(user);
    database.isRegisteredUser.mockReturnValueOnce(false);

    const r = await request(a)
      .get('/v1/registrations/available')
      .query({ email })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(r.body).toEqual({ email: true });

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.findUser).toHaveBeenNthCalledWith(1, email);
    expect(database.isRegisteredUser).toHaveBeenNthCalledWith(1, user);
  });

  test('GET /v1/registrations/available should reject invalid email', async () => {
    const a = await app.initialize();
    emailValidator.validate.mockReturnValueOnce(false);
    const email = 'test@example.com';

    const r = await request(a)
      .get('/v1/registrations/available')
      .query({ email })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.findUser).not.toBeCalled();
    expect(database.isRegisteredUser).not.toBeCalled();
  });

  test('GET /v1/registrations/available should report internal service error correctly', async () => {
    const a = await app.initialize();
    emailValidator.validate.mockReturnValueOnce(true);
    const email = 'test@example.com';
    database.findUser.mockRejectedValueOnce(new Error('TEST'));

    const r = await request(a)
      .get('/v1/registrations/available')
      .query({ email })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.findUser).toBeCalledTimes(1);
    expect(database.isRegisteredUser).not.toBeCalled();
  });

  test('POST /v1/registrations should work', async () => {
    const a = await app.initialize();
    emailValidator.validate.mockReturnValueOnce(true);
    passwordValidator.validate.mockReturnValueOnce(true);
    const user = {
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      password: 'ASDqwe123',
      language: 'en',
    };
    const foundUser = {};
    database.findUser.mockResolvedValueOnce(foundUser);
    database.isRegisteredUser.mockReturnValueOnce(false);
    const salt = 'salt';
    bcrypt.genSalt.mockResolvedValueOnce(salt);
    const hash = 'hash';
    bcrypt.hash.mockResolvedValueOnce(hash);
    const registrationRequest = {
      id: 'id',
      expires: 'expires',
    };
    reqstore.createRegistrationRequest.mockResolvedValueOnce(
      registrationRequest
    );
    emailer.registration.mockResolvedValueOnce({});

    const r = await request(a)
      .post('/v1/registrations')
      .send(user)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(202);

    expect(r.body).toEqual({ expires: registrationRequest.expires });

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(emailValidator.validate).toHaveBeenNthCalledWith(1, user.email);
    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(passwordValidator.validate).toHaveBeenNthCalledWith(
      1,
      user.password
    );
    expect(database.findUser).toBeCalledTimes(1);
    expect(database.findUser).toHaveBeenNthCalledWith(1, user.email);
    expect(database.isRegisteredUser).toBeCalledTimes(1);
    expect(database.isRegisteredUser).toHaveBeenNthCalledWith(1, foundUser);
    expect(bcrypt.genSalt).toBeCalledTimes(1);
    expect(bcrypt.genSalt).toHaveBeenNthCalledWith(1, config.saltRounds);
    expect(bcrypt.hash).toBeCalledTimes(1);
    expect(bcrypt.hash).toHaveBeenNthCalledWith(1, user.password, salt);
    expect(reqstore.createRegistrationRequest).toBeCalledTimes(1);
    expect(reqstore.createRegistrationRequest).toHaveBeenNthCalledWith(1, {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      passhash: hash,
      language: user.language,
    });
    expect(emailer.registration).toBeCalledTimes(1);
    expect(emailer.registration).toHaveBeenNthCalledWith(1, {
      id: registrationRequest.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      language: user.language,
    });
  });

  test('POST /v1/registrations should reject invalid data', async () => {
    const a = await app.initialize();
    const user = {
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      password: 'ASDqwe123',
      language: 'en',
    };

    emailValidator.validate.mockReturnValueOnce(false);
    passwordValidator.validate.mockReturnValueOnce(true);

    let r = await request(a)
      .post('/v1/registrations')
      .send(user)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(400);
    expect(r.body).toEqual({ error: 'Invalid data' });
    expect(emailValidator.validate).toBeCalled();
    expect(passwordValidator.validate).toBeCalled();

    emailValidator.validate.mockReturnValueOnce(true);
    passwordValidator.validate.mockReturnValueOnce(false);

    r = await request(a)
      .post('/v1/registrations')
      .send(user)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(400);
    expect(r.body).toEqual({ error: 'Invalid data' });
    expect(emailValidator.validate).toBeCalled();
    expect(passwordValidator.validate).toBeCalled();
  });

  test('POST /v1/registrations should reject existing user', async () => {
    const a = await app.initialize();
    const user = {
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      password: 'ASDqwe123',
      language: 'en',
    };
    emailValidator.validate.mockReturnValueOnce(true);
    passwordValidator.validate.mockReturnValueOnce(true);
    const foundUser = {};
    database.findUser.mockResolvedValueOnce(foundUser);
    database.isRegisteredUser.mockReturnValueOnce(true);

    const r = await request(a)
      .post('/v1/registrations')
      .send(user)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(409);
    expect(r.body).toEqual({ error: 'User already exists' });

    expect(emailValidator.validate).toBeCalled();
    expect(passwordValidator.validate).toBeCalled();
    expect(database.findUser).toBeCalledTimes(1);
    expect(database.isRegisteredUser).toBeCalledTimes(1);
    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
  });

  test('POST /v1/registrations should report internal service error correctly', async () => {
    const a = await app.initialize();
    const user = {
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      password: 'ASDqwe123',
      language: 'en',
    };
    emailValidator.validate.mockReturnValueOnce(true);
    passwordValidator.validate.mockReturnValueOnce(true);
    database.findUser.mockRejectedValueOnce(new Error('TEST'));

    const r = await request(a)
      .post('/v1/registrations')
      .send(user)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(500);
    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(database.isRegisteredUser).not.toBeCalled();
  });

  test('POST /v1/registrations/{id} should work', async () => {
    const a = await app.initialize();
    const id = '1234';
    const registrationRequest = { email: 'test@example.com' };
    reqstore.resolveRegistrationRequest.mockResolvedValueOnce(
      registrationRequest
    );
    const foundUser = {
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
    };
    database.findUser.mockResolvedValueOnce(foundUser);
    database.isRegisteredUser.mockReturnValueOnce(false);
    const user = {
      ...foundUser,
    };
    database.addOrModifyUser.mockResolvedValueOnce(user);

    const r = await request(a)
      .post(`/v1/registrations/${id}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(201);

    expect(r.body).toEqual({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    });

    expect(reqstore.resolveRegistrationRequest).toBeCalledTimes(1);
    expect(reqstore.resolveRegistrationRequest).toHaveBeenNthCalledWith(1, id);

    expect(database.findUser).toBeCalledTimes(1);
    expect(database.findUser).toHaveBeenNthCalledWith(
      1,
      registrationRequest.email
    );

    expect(database.isRegisteredUser).toBeCalledTimes(1);
    expect(database.isRegisteredUser).toHaveBeenNthCalledWith(1, foundUser);

    expect(database.addOrModifyUser).toBeCalledTimes(1);
    expect(database.addOrModifyUser).toHaveBeenNthCalledWith(
      1,
      registrationRequest
    );
  });

  test('POST /v1/registrations/{id} should reject not found request', async () => {
    const a = await app.initialize();
    const id = '1234';
    reqstore.resolveRegistrationRequest.mockResolvedValueOnce(undefined);

    const r = await request(a)
      .post(`/v1/registrations/${id}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });

    expect(reqstore.resolveRegistrationRequest).toBeCalledTimes(1);
    expect(reqstore.resolveRegistrationRequest).toHaveBeenNthCalledWith(1, id);

    expect(database.findUser).not.toBeCalled();
    expect(database.isRegisteredUser).not.toBeCalled();
    expect(database.addOrModifyUser).not.toBeCalled();
  });

  test('POST /v1/registrations/{id} should reject already registered user', async () => {
    const a = await app.initialize();
    const id = '1234';
    const registrationRequest = { email: 'test@example.com' };
    reqstore.resolveRegistrationRequest.mockResolvedValueOnce(
      registrationRequest
    );
    const foundUser = {
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
    };
    database.findUser.mockResolvedValueOnce(foundUser);
    database.isRegisteredUser.mockReturnValueOnce(true);

    const r = await request(a)
      .post(`/v1/registrations/${id}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(409);

    expect(r.body).toEqual({ error: 'User already exists' });

    expect(reqstore.resolveRegistrationRequest).toBeCalledTimes(1);
    expect(database.findUser).toBeCalledTimes(1);
    expect(database.isRegisteredUser).toBeCalledTimes(1);

    expect(database.addOrModifyUser).not.toBeCalled();
  });

  test('POST /v1/registrations/{id} should report internal service error correctly', async () => {
    const a = await app.initialize();
    const id = '1234';
    const registrationRequest = { email: 'test@example.com' };
    reqstore.resolveRegistrationRequest.mockResolvedValueOnce(
      registrationRequest
    );
    database.findUser.mockRejectedValueOnce(new Error('TEST'));

    const r = await request(a)
      .post(`/v1/registrations/${id}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(reqstore.resolveRegistrationRequest).toBeCalledTimes(1);
    expect(database.findUser).toBeCalledTimes(1);

    expect(database.isRegisteredUser).not.toBeCalled();
    expect(database.addOrModifyUser).not.toBeCalled();
  });

  test('POST /v1/password_resets should work', async () => {
    const a = await app.initialize();
    const email = 'test@example.com';
    emailValidator.validate.mockResolvedValueOnce(email);
    const foundUser = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      language: 'en',
    };
    database.findUser.mockResolvedValueOnce(foundUser);
    database.isRegisteredUser.mockReturnValueOnce(true);
    const passwordResetRequest = {
      id: 'request-id',
      expires: 'expires',
    };
    reqstore.createPasswordResetRequest.mockResolvedValueOnce(
      passwordResetRequest
    );
    emailer.resetPassword.mockResolvedValueOnce(true);

    const r = await request(a)
      .post('/v1/password_resets')
      .send({ email })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(202);

    expect(r.body).toEqual({
      expires: passwordResetRequest.expires,
    });

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(emailValidator.validate).toHaveBeenNthCalledWith(1, email);

    expect(database.findUser).toBeCalledTimes(1);
    expect(database.findUser).toHaveBeenNthCalledWith(1, email);

    expect(database.isRegisteredUser).toBeCalledTimes(1);
    expect(database.isRegisteredUser).toHaveBeenNthCalledWith(1, foundUser);

    expect(reqstore.createPasswordResetRequest).toBeCalledTimes(1);
    expect(reqstore.createPasswordResetRequest).toHaveBeenNthCalledWith(1, {
      userId: foundUser.id,
    });

    expect(emailer.resetPassword).toBeCalledTimes(1);
    expect(emailer.resetPassword).toHaveBeenNthCalledWith(1, {
      id: passwordResetRequest.id,
      email,
      firstName: foundUser.firstName,
      lastName: foundUser.lastName,
      language: foundUser.language,
    });
  });

  test('POST /v1/password_resets should reject invalid email', async () => {
    const a = await app.initialize();
    const email = 'test@example.com';
    emailValidator.validate.mockReturnValueOnce(undefined);

    const r = await request(a)
      .post('/v1/password_resets/')
      .send({ email })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(database.findUser).not.toBeCalled();
    expect(database.isRegisteredUser).not.toBeCalled();
    expect(reqstore.createPasswordResetRequest).not.toBeCalled();
    expect(emailer.resetPassword).not.toBeCalled();
  });

  test('POST /v1/password_resets should reject not found user', async () => {
    const a = await app.initialize();
    const email = 'test@example.com';
    emailValidator.validate.mockResolvedValueOnce(email);
    const foundUser = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      language: 'en',
    };
    database.findUser.mockResolvedValueOnce(foundUser);
    database.isRegisteredUser.mockReturnValueOnce(false);

    const r = await request(a)
      .post('/v1/password_resets/')
      .send({ email })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });

    expect(database.findUser).toBeCalledTimes(1);
    expect(database.isRegisteredUser).toBeCalledTimes(1);
    expect(reqstore.createPasswordResetRequest).not.toBeCalled();
    expect(emailer.resetPassword).not.toBeCalled();
  });

  test('POST /v1/password_resets should report internal service error correctly', async () => {
    const a = await app.initialize();
    const email = 'test@example.com';
    emailValidator.validate.mockResolvedValueOnce(email);
    database.findUser.mockRejectedValueOnce(new Error('TEST'));

    const r = await request(a)
      .post('/v1/password_resets/')
      .send({ email })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(database.findUser).toBeCalledTimes(1);
    expect(database.isRegisteredUser).not.toBeCalled();
    expect(reqstore.createPasswordResetRequest).not.toBeCalled();
    expect(emailer.resetPassword).not.toBeCalled();
  });

  test('POST /v1/password_resets/{id} should work', async () => {
    const a = await app.initialize();
    const id = '1234';
    const password = 'password';
    passwordValidator.validate.mockReturnValueOnce(password);
    const passwordResetRequest = { userId: 'user-id' };
    reqstore.resolvePasswordResetRequest.mockResolvedValueOnce(
      passwordResetRequest
    );
    const salt = 'salt';
    bcrypt.genSalt.mockResolvedValueOnce(salt);
    const hash = 'hash';
    bcrypt.hash.mockResolvedValueOnce(hash);
    const modifiedUser = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      language: 'en',
    };
    database.modifyUser.mockResolvedValueOnce(modifiedUser);
    const r = await request(a)
      .post(`/v1/password_resets/${id}`)
      .send({ password })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(r.body).toEqual({
      firstName: modifiedUser.firstName,
      lastName: modifiedUser.lastName,
      email: modifiedUser.email,
    });

    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(passwordValidator.validate).toHaveBeenNthCalledWith(1, password);

    expect(reqstore.resolvePasswordResetRequest).toBeCalledTimes(1);
    expect(reqstore.resolvePasswordResetRequest).toHaveBeenNthCalledWith(1, id);

    expect(bcrypt.genSalt).toBeCalledTimes(1);
    expect(bcrypt.genSalt).toHaveBeenNthCalledWith(1, config.saltRounds);

    expect(bcrypt.hash).toBeCalledTimes(1);
    expect(bcrypt.hash).toHaveBeenNthCalledWith(1, password, salt);

    expect(database.modifyUser).toBeCalledTimes(1);
    expect(database.modifyUser).toHaveBeenNthCalledWith(
      1,
      passwordResetRequest.userId,
      { passhash: hash }
    );
  });

  test('POST /v1/password_resets/{id} should reject invalid password', async () => {
    const a = await app.initialize();
    const id = '1234';
    const password = 'password';
    passwordValidator.validate.mockReturnValueOnce(undefined);
    const r = await request(a)
      .post(`/v1/password_resets/${id}`)
      .send({ password })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(passwordValidator.validate).toBeCalledTimes(1);

    expect(reqstore.resolvePasswordResetRequest).not.toBeCalled();
    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
  });

  test('POST /v1/password_resets/{id} should reject not found request', async () => {
    const a = await app.initialize();
    const id = '1234';
    const password = 'password';
    passwordValidator.validate.mockReturnValueOnce(password);
    reqstore.resolvePasswordResetRequest.mockResolvedValueOnce(undefined);
    const r = await request(a)
      .post(`/v1/password_resets/${id}`)
      .send({ password })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });

    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(reqstore.resolvePasswordResetRequest).toBeCalledTimes(1);

    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
  });

  test('POST /v1/password_resets/{id} should reject disappeared user', async () => {
    const a = await app.initialize();
    const id = '1234';
    const password = 'password';
    passwordValidator.validate.mockReturnValueOnce(password);
    const passwordResetRequest = { userId: 'user-id' };
    reqstore.resolvePasswordResetRequest.mockResolvedValueOnce(
      passwordResetRequest
    );
    const salt = 'salt';
    bcrypt.genSalt.mockResolvedValueOnce(salt);
    const hash = 'hash';
    bcrypt.hash.mockResolvedValueOnce(hash);
    database.modifyUser.mockResolvedValueOnce(undefined);
    const r = await request(a)
      .post(`/v1/password_resets/${id}`)
      .send({ password })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(reqstore.resolvePasswordResetRequest).toBeCalledTimes(1);
    expect(bcrypt.genSalt).toBeCalledTimes(1);
    expect(bcrypt.hash).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);
  });

  test('POST /v1/password_resets/{id} should report internal service error correctly', async () => {
    const a = await app.initialize();
    const id = '1234';
    const password = 'password';
    passwordValidator.validate.mockReturnValueOnce(password);
    const passwordResetRequest = { userId: 'user-id' };
    reqstore.resolvePasswordResetRequest.mockResolvedValueOnce(
      passwordResetRequest
    );
    const salt = 'salt';
    bcrypt.genSalt.mockResolvedValueOnce(salt);
    const hash = 'hash';
    bcrypt.hash.mockResolvedValueOnce(hash);
    database.modifyUser.mockRejectedValueOnce(new Error('TEST'));
    const r = await request(a)
      .post(`/v1/password_resets/${id}`)
      .send({ password })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(reqstore.resolvePasswordResetRequest).toBeCalledTimes(1);
    expect(bcrypt.genSalt).toBeCalledTimes(1);
    expect(bcrypt.hash).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);
  });

  test('POST /v1/email_changes/{id} should work', async () => {
    const a = await app.initialize();
    const id = '1234';
    const emailChangeRequest = { userId: 'user-id', newEmail: 'new-email' };
    reqstore.resolveEmailChangeRequest.mockResolvedValueOnce(
      emailChangeRequest
    );
    const modifiedUser = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      language: 'en',
    };
    database.modifyUser.mockResolvedValueOnce(modifiedUser);
    const r = await request(a)
      .post(`/v1/email_changes/${id}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(r.body).toEqual({
      firstName: modifiedUser.firstName,
      lastName: modifiedUser.lastName,
      email: modifiedUser.email,
    });

    expect(reqstore.resolveEmailChangeRequest).toBeCalledTimes(1);
    expect(reqstore.resolveEmailChangeRequest).toHaveBeenNthCalledWith(1, id);

    expect(database.modifyUser).toBeCalledTimes(1);
    expect(database.modifyUser).toHaveBeenNthCalledWith(
      1,
      emailChangeRequest.userId,
      { email: emailChangeRequest.newEmail }
    );
  });

  test('POST /v1/email_changes/{id} should reject not found request', async () => {
    const a = await app.initialize();
    const id = '1234';
    reqstore.resolveEmailChangeRequest.mockResolvedValueOnce(undefined);
    const r = await request(a)
      .post(`/v1/email_changes/${id}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });

    expect(reqstore.resolveEmailChangeRequest).toBeCalledTimes(1);
    expect(reqstore.resolveEmailChangeRequest).toHaveBeenNthCalledWith(1, id);

    expect(database.modifyUser).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
  });

  test('POST /v1/email_changes/{id} should reject disappeared user', async () => {
    const a = await app.initialize();
    const id = '1234';
    const emailChangeRequest = { userId: 'user-id', newEmail: 'new-email' };
    reqstore.resolveEmailChangeRequest.mockResolvedValueOnce(
      emailChangeRequest
    );
    database.modifyUser.mockResolvedValueOnce(undefined);
    const r = await request(a)
      .post(`/v1/email_changes/${id}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(reqstore.resolveEmailChangeRequest).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);
  });

  test('POST /v1/email_changes/{id} should report internal service error correctly', async () => {
    const a = await app.initialize();
    const id = '1234';
    const emailChangeRequest = { userId: 'user-id', newEmail: 'new-email' };
    reqstore.resolveEmailChangeRequest.mockResolvedValueOnce(
      emailChangeRequest
    );
    database.modifyUser.mockRejectedValueOnce(new Error('TEST'));
    const r = await request(a)
      .post(`/v1/email_changes/${id}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(reqstore.resolveEmailChangeRequest).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);
  });

  test('POST /v1/invites/{id} should work', async () => {
    const a = await app.initialize();
    const id = '1234';
    const user = {
      firstName: 'John',
      lastName: 'Random',
      password: 'password',
      language: 'en',
    };
    passwordValidator.validate.mockReturnValueOnce(user.password);
    const invite = { user: 'user-id' };
    database.deleteInvite.mockResolvedValueOnce(invite);
    const salt = 'salt';
    bcrypt.genSalt.mockResolvedValueOnce(salt);
    const hash = 'hash';
    bcrypt.hash.mockResolvedValueOnce(hash);
    const modifiedUser = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      language: 'en',
    };
    database.modifyUser.mockResolvedValueOnce(modifiedUser);

    const r = await request(a)
      .post(`/v1/invites/${id}`)
      .send(user)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(r.body).toEqual({
      firstName: modifiedUser.firstName,
      lastName: modifiedUser.lastName,
      email: modifiedUser.email,
    });

    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(passwordValidator.validate).toHaveBeenNthCalledWith(
      1,
      user.password
    );

    expect(database.deleteInvite).toBeCalledTimes(1);
    expect(database.deleteInvite).toHaveBeenNthCalledWith(1, id);

    expect(bcrypt.genSalt).toBeCalledTimes(1);
    expect(bcrypt.genSalt).toHaveBeenNthCalledWith(1, config.saltRounds);

    expect(bcrypt.hash).toBeCalledTimes(1);
    expect(bcrypt.hash).toHaveBeenNthCalledWith(1, user.password, salt);

    expect(database.modifyUser).toBeCalledTimes(1);
    expect(database.modifyUser).toHaveBeenNthCalledWith(1, invite.user, {
      firstName: user.firstName,
      lastName: user.lastName,
      passhash: hash,
      language: user.language,
    });
  });

  test('POST /v1/invites/{id} should reject invalid data', async () => {
    const a = await app.initialize();
    const id = '1234';
    const user = {
      firstName: 'John',
      lastName: 'Random',
      password: 'password',
      language: 'en',
    };
    passwordValidator.validate.mockReturnValueOnce(undefined);
    const r = await request(a)
      .post(`/v1/invites/${id}`)
      .send(user)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(passwordValidator.validate).toBeCalledTimes(1);

    expect(database.deleteInvite).not.toBeCalled();
    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
  });

  test('POST /v1/invites/{id} should reject not found invite', async () => {
    const a = await app.initialize();
    const id = '1234';
    const user = {
      firstName: 'John',
      lastName: 'Random',
      password: 'password',
      language: 'en',
    };
    passwordValidator.validate.mockReturnValueOnce(user.password);
    database.deleteInvite.mockResolvedValueOnce(undefined);
    const r = await request(a)
      .post(`/v1/invites/${id}`)
      .send(user)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });

    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(database.deleteInvite).toBeCalledTimes(1);

    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
  });

  test('POST /v1/invites/{id} should reject disappeared user', async () => {
    const a = await app.initialize();
    const id = '1234';
    const user = {
      firstName: 'John',
      lastName: 'Random',
      password: 'password',
      language: 'en',
    };
    passwordValidator.validate.mockReturnValueOnce(user.password);
    const invite = { user: 'user-id' };
    database.deleteInvite.mockResolvedValueOnce(invite);
    const salt = 'salt';
    bcrypt.genSalt.mockResolvedValueOnce(salt);
    const hash = 'hash';
    bcrypt.hash.mockResolvedValueOnce(hash);
    database.modifyUser.mockResolvedValueOnce(undefined);

    const r = await request(a)
      .post(`/v1/invites/${id}`)
      .send(user)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(database.deleteInvite).toBeCalledTimes(1);
    expect(bcrypt.genSalt).toBeCalledTimes(1);
    expect(bcrypt.hash).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);
  });

  test('POST /v1/invites/{id} should report internal service error correctly', async () => {
    const a = await app.initialize();
    const id = '1234';
    const user = {
      firstName: 'John',
      lastName: 'Random',
      password: 'password',
      language: 'en',
    };
    passwordValidator.validate.mockReturnValueOnce(user.password);
    database.deleteInvite.mockRejectedValueOnce(new Error('TEST'));
    const r = await request(a)
      .post(`/v1/invites/${id}`)
      .send(user)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(database.deleteInvite).toBeCalledTimes(1);

    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
  });

  test('DELETE /v1/invites/{id} should work', async () => {
    const a = await app.initialize();
    const id = '1234';
    const invite = { user: 'user-id' };
    database.deleteInvite.mockResolvedValueOnce(invite);
    const user = {
      id: invite.user,
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      language: 'en',
    };
    database.getUser.mockResolvedValueOnce(user);
    database.isRegisteredUser.mockReturnValueOnce(false);
    database.deleteUser.mockResolvedValueOnce(user);
    database.ignore.mockResolvedValueOnce(true);

    const r = await request(a)
      .delete(`/v1/invites/${id}`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(database.getUser).toBeCalledTimes(1);
    expect(database.getUser).toHaveBeenNthCalledWith(1, invite.user);

    expect(database.isRegisteredUser).toBeCalledTimes(1);
    expect(database.isRegisteredUser).toHaveBeenNthCalledWith(1, user);

    expect(database.deleteInvite).toBeCalledTimes(1);
    expect(database.deleteInvite).toHaveBeenNthCalledWith(1, id);

    expect(database.deleteUser).toBeCalledTimes(1);
    expect(database.deleteUser).toHaveBeenNthCalledWith(1, invite.user);

    expect(database.ignore).toBeCalledTimes(1);
    expect(database.ignore).toHaveBeenNthCalledWith(1, user.email);
  });

  test('DELETE /v1/invites/{id} should reject not found invite', async () => {
    const a = await app.initialize();
    const id = '1234';
    database.deleteInvite.mockResolvedValueOnce(undefined);
    const r = await request(a)
      .delete(`/v1/invites/${id}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });

    expect(database.deleteInvite).toBeCalledTimes(1);

    expect(database.getUser).not.toBeCalled();
    expect(database.isRegisteredUser).not.toBeCalled();
    expect(database.deleteUser).not.toBeCalled();
    expect(database.ignore).not.toBeCalled();
  });

  test('DELETE /v1/invites/{id} should ignore not found user', async () => {
    const a = await app.initialize();
    const id = '1234';
    const invite = { user: 'user-id' };
    database.deleteInvite.mockResolvedValueOnce(invite);
    database.getUser.mockResolvedValueOnce(undefined);

    const r = await request(a)
      .delete(`/v1/invites/${id}`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(database.deleteInvite).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);

    expect(database.isRegisteredUser).not.toBeCalled();
    expect(database.deleteUser).not.toBeCalled();
    expect(database.ignore).not.toBeCalled();
  });

  test('DELETE /v1/invites/{id} should not delete registered user', async () => {
    const a = await app.initialize();
    const id = '1234';
    const invite = { user: 'user-id' };
    database.deleteInvite.mockResolvedValueOnce(invite);
    const user = { id: invite.user };
    database.getUser.mockResolvedValueOnce(user);
    database.isRegisteredUser.mockReturnValueOnce(true);

    const r = await request(a)
      .delete(`/v1/invites/${id}`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(database.deleteInvite).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(database.isRegisteredUser).toBeCalledTimes(1);

    expect(database.deleteUser).not.toBeCalled();

    expect(database.ignore).toBeCalledTimes(1);
  });

  test('DELETE /v1/invites/{id} should report internal service error correctly', async () => {
    const a = await app.initialize();
    const id = '1234';
    database.deleteInvite.mockRejectedValueOnce(new Error('TEST'));

    const r = await request(a)
      .delete(`/v1/invites/${id}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(database.deleteInvite).toBeCalledTimes(1);

    expect(database.deleteUser).not.toBeCalled();
    expect(database.ignore).not.toBeCalled();
  });

  test('POST /v1/me/login should work', async () => {
    const a = await app.initialize();
    const credentials = { email: 'test@example.com', password: 'password' };
    emailValidator.validate.mockReturnValueOnce(credentials.email);
    const user = {
      id: 'user-id',
      passhash: 'hash',
    };
    database.findUser.mockResolvedValueOnce(user);
    bcrypt.compare.mockReturnValueOnce(true);
    const s = { token: 'token', expires: 'expires' };
    sesstore.startSession.mockResolvedValueOnce(s);

    const r = await request(a)
      .post('/v1/me/login')
      .send(credentials)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(201);

    expect(r.body).toEqual(s);

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(emailValidator.validate).toHaveBeenNthCalledWith(
      1,
      credentials.email
    );

    expect(database.findUser).toBeCalledTimes(1);
    expect(database.findUser).toHaveBeenNthCalledWith(1, credentials.email);

    expect(bcrypt.compare).toBeCalledTimes(1);
    expect(bcrypt.compare).toHaveBeenNthCalledWith(
      1,
      credentials.password,
      user.passhash
    );

    expect(sesstore.startSession).toBeCalledTimes(1);
    expect(sesstore.startSession).toHaveBeenNthCalledWith(1, user.id);
  });

  test('POST /v1/me/login should reject invalid email', async () => {
    const a = await app.initialize();
    const credentials = { email: 'test@example.com', password: 'password' };
    emailValidator.validate.mockReturnValueOnce(undefined);
    const r = await request(a)
      .post('/v1/me/login')
      .send(credentials)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(emailValidator.validate).toBeCalledTimes(1);

    expect(database.findUser).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(sesstore.startSession).not.toBeCalled();
  });

  test('POST /v1/me/login should reject not found user', async () => {
    const a = await app.initialize();
    const credentials = { email: 'test@example.com', password: 'password' };
    emailValidator.validate.mockReturnValueOnce(credentials.email);
    database.findUser.mockResolvedValueOnce(undefined);
    const r = await request(a)
      .post('/v1/me/login')
      .send(credentials)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.findUser).toBeCalledTimes(1);

    expect(bcrypt.compare).not.toBeCalled();
    expect(sesstore.startSession).not.toBeCalled();
  });

  test('POST /v1/me/login should reject incorrect password', async () => {
    const a = await app.initialize();
    const credentials = { email: 'test@example.com', password: 'password' };
    emailValidator.validate.mockReturnValueOnce(credentials.email);
    const user = {
      id: 'user-id',
      passhash: 'hash',
    };
    database.findUser.mockResolvedValueOnce(user);
    bcrypt.compare.mockReturnValueOnce(false);

    const r = await request(a)
      .post('/v1/me/login')
      .send(credentials)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.findUser).toBeCalledTimes(1);
    expect(bcrypt.compare).toBeCalledTimes(1);

    expect(sesstore.startSession).not.toBeCalled();
  });

  test('POST /v1/me/login should report internal service error correctly', async () => {
    const a = await app.initialize();
    const credentials = { email: 'test@example.com', password: 'password' };
    emailValidator.validate.mockReturnValueOnce(credentials.email);
    database.findUser.mockRejectedValueOnce(new Error('TEST'));

    const r = await request(a)
      .post('/v1/me/login')
      .send(credentials)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.findUser).toBeCalledTimes(1);

    expect(bcrypt.compare).not.toBeCalled();
    expect(sesstore.startSession).not.toBeCalled();
  });

  test('POST /v1/me/renew should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const renewedSession = { token: 'token', expires: 'expires' };
    sesstore.renewSession.mockResolvedValueOnce(renewedSession);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/me/renew')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(r.body).toEqual(renewedSession);

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(sesstore.renewSession).toBeCalledTimes(1);
    expect(sesstore.renewSession).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
      data: sessionData,
    });
  });

  test('POST /v1/me/renew should reject missing session token', async () => {
    const a = await app.initialize();
    const r = await request(a)
      .post('/v1/me/renew')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(sesstore.renewSession).not.toBeCalled();
  });

  test('POST /v1/me/renew should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/me/renew')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.renewSession).not.toBeCalled();
  });

  test('POST /v1/me/renew should fail on session store failure', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/me/renew')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.renewSession).not.toBeCalled();
  });

  test('POST /v1/me/renew should fail on renew failure', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    sesstore.renewSession.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/me/renew')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.renewSession).toBeCalledTimes(1);
  });

  test('POST /v1/me/renew should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    sesstore.renewSession.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/me/renew')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.renewSession).toBeCalledTimes(1);
  });

  test('POST /v1/me/logout should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/me/logout')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(publisher.logout).toBeCalledTimes(1);
    expect(publisher.logout).toHaveBeenNthCalledWith(1, sessionData);

    expect(sesstore.endSession).toBeCalledTimes(1);
    expect(sesstore.endSession).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
      data: sessionData,
    });
  });

  test('POST /v1/me/logout should fail on missing session token', async () => {
    const a = await app.initialize();

    const r = await request(a)
      .post('/v1/me/logout')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('POST /v1/me/logout should fail on not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/me/logout')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(sesstore.renewSession).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('POST /v1/me/logout should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/me/logout')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);
  });

  test('GET /v1/me should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const user = {
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      language: 'en',
      avatar: 'avatar',
    };
    database.getUser.mockResolvedValueOnce(user);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/me')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual(user);

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.getUser).toBeCalledTimes(1);
    expect(database.getUser).toHaveBeenNthCalledWith(1, sessionData);

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('GET /v1/me should reject missing session token', async () => {
    const a = await app.initialize();

    const r = await request(a)
      .get('/v1/me')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.getUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('GET /v1/me should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/me')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.getUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('GET /v1/me should reject disappeared user', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.getUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/me')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);
  });

  test('GET /v1/me should end corrupted session correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.getUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockRejectedValueOnce(new Error('TEST'));
    sesstore.endSession.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/me')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);
  });

  test('GET /v1/me should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.getUser.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/me')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('DELETE /v1/me should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const user = {
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      passhash: 'hash',
      language: 'en',
      avatar: null,
    };
    database.getUser.mockResolvedValueOnce(user);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    bcrypt.compare.mockResolvedValueOnce(true);
    database.deleteUser.mockResolvedValueOnce(true);
    const password = 'password';
    const sessionToken = 'session-token';

    const r = await request(a)
      .delete('/v1/me')
      .send({ password })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.getUser).toBeCalledTimes(1);
    expect(database.getUser).toHaveBeenNthCalledWith(1, sessionData);

    expect(bcrypt.compare).toBeCalledTimes(1);
    expect(bcrypt.compare).toHaveBeenNthCalledWith(1, password, user.passhash);

    expect(database.deleteUser).toBeCalledTimes(1);
    expect(database.deleteUser).toHaveBeenNthCalledWith(1, sessionData);

    expect(filestore.deleteImage).not.toBeCalled();

    expect(publisher.logout).toBeCalledTimes(1);
    expect(publisher.logout).toHaveBeenNthCalledWith(1, sessionData);

    expect(sesstore.endSession).toBeCalledTimes(1);
    expect(sesstore.endSession).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
      data: sessionData,
    });
  });

  test('DELETE /v1/me should reject missing session token', async () => {
    const a = await app.initialize();
    const password = 'password';

    const r = await request(a)
      .delete('/v1/me')
      .send({ password })
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.getUser).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(database.deleteUser).not.toBeCalled();
    expect(filestore.deleteImage).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('DELETE /v1/me should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const password = 'password';
    const sessionToken = 'session-token';

    const r = await request(a)
      .delete('/v1/me')
      .send({ password })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.getUser).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(database.deleteUser).not.toBeCalled();
    expect(filestore.deleteImage).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
    expect(database.getUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
  });

  test('DELETE /v1/me should reject disappeared user', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.getUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    const password = 'password';
    const sessionToken = 'session-token';

    const r = await request(a)
      .delete('/v1/me')
      .send({ password })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);

    expect(bcrypt.compare).not.toBeCalled();
    expect(database.deleteUser).not.toBeCalled();
    expect(filestore.deleteImage).not.toBeCalled();
  });

  test('DELETE /v1/me should reject invalid password', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const user = {
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      passhash: 'hash',
      language: 'en',
      avatar: 'avatar',
    };
    database.getUser.mockResolvedValueOnce(user);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    bcrypt.compare.mockResolvedValueOnce(false);
    const password = 'password';
    const sessionToken = 'session-token';

    const r = await request(a)
      .delete('/v1/me')
      .send({ password })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid password' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(bcrypt.compare).toBeCalledTimes(1);

    expect(database.deleteUser).not.toBeCalled();
    expect(filestore.deleteImage).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('DELETE /v1/me should delete unused avatar image', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const user = {
      firstName: 'John',
      lastName: 'Random',
      email: 'test@example.com',
      passhash: 'hash',
      language: 'en',
      avatar: 'avatar',
    };
    database.getUser.mockResolvedValueOnce(user);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    bcrypt.compare.mockResolvedValueOnce(true);
    database.deleteUser.mockResolvedValueOnce(true);
    filestore.deleteImage.mockResolvedValueOnce(true);
    const password = 'password';
    const sessionToken = 'session-token';

    const r = await request(a)
      .delete('/v1/me')
      .send({ password })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(bcrypt.compare).toBeCalledTimes(1);
    expect(database.deleteUser).toBeCalledTimes(1);

    expect(filestore.deleteImage).toBeCalledTimes(1);
    expect(filestore.deleteImage).toHaveBeenNthCalledWith(1, user.avatar);

    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);
  });

  test('DELETE /v1/me should end corrupted session correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.getUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockRejectedValueOnce(new Error('TEST'));
    sesstore.endSession.mockRejectedValueOnce(new Error('TEST'));
    const password = 'password';
    const sessionToken = 'session-token';

    const r = await request(a)
      .delete('/v1/me')
      .send({ password })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);

    expect(bcrypt.compare).not.toBeCalled();
    expect(database.deleteUser).not.toBeCalled();
    expect(filestore.deleteImage).not.toBeCalled();
  });

  test('DELETE /v1/me should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.getUser.mockRejectedValueOnce(new Error('TEST'));
    const password = 'password';
    const sessionToken = 'session-token';

    const r = await request(a)
      .delete('/v1/me')
      .send({ password })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);

    expect(bcrypt.compare).not.toBeCalled();
    expect(database.deleteUser).not.toBeCalled();
    expect(filestore.deleteImage).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/email should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const password = 'password';
    const newEmail = 'test-2@example.com';
    const user = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      language: 'en',
      passhash: 'hash',
    };
    database.getUser.mockResolvedValueOnce(user);
    emailValidator.validate.mockReturnValueOnce(newEmail);
    bcrypt.compare.mockResolvedValueOnce(true);
    const emailChangeRequest = { id: 'user-id', expires: 'expires' };
    reqstore.createEmailChangeRequest.mockResolvedValueOnce(emailChangeRequest);
    emailer.changeEmail.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/email')
      .send({ password, newEmail })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(202);

    expect(r.body).toEqual({ expires: emailChangeRequest.expires });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.getUser).toBeCalledTimes(1);
    expect(database.getUser).toHaveBeenNthCalledWith(1, sessionData);

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(emailValidator.validate).toHaveBeenNthCalledWith(1, newEmail);

    expect(bcrypt.compare).toBeCalledTimes(1);
    expect(bcrypt.compare).toHaveBeenNthCalledWith(1, password, user.passhash);

    expect(reqstore.createEmailChangeRequest).toBeCalledTimes(1);
    expect(reqstore.createEmailChangeRequest).toHaveBeenNthCalledWith(1, {
      userId: user.id,
      newEmail,
    });

    expect(emailer.changeEmail).toBeCalledTimes(1);
    expect(emailer.changeEmail).toHaveBeenNthCalledWith(1, {
      id: user.id,
      email: newEmail,
      firstName: user.firstName,
      lastName: user.lastName,
      language: user.language,
    });

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/email should reject missing session token', async () => {
    const a = await app.initialize();
    const password = 'password';
    const newEmail = 'test-2@example.com';

    const r = await request(a)
      .put('/v1/me/email')
      .send({ password, newEmail })
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.getUser).not.toBeCalled();
    expect(emailValidator.validate).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(reqstore.createEmailChangeRequest).not.toBeCalled();
    expect(emailer.changeEmail).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/email should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const password = 'password';
    const newEmail = 'test-2@example.com';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/email')
      .send({ password, newEmail })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.getUser).not.toBeCalled();
    expect(emailValidator.validate).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(reqstore.createEmailChangeRequest).not.toBeCalled();
    expect(emailer.changeEmail).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/email should reject disappeared user', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const password = 'password';
    const newEmail = 'test-2@example.com';
    database.getUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/email')
      .send({ password, newEmail })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);

    expect(emailValidator.validate).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(reqstore.createEmailChangeRequest).not.toBeCalled();
    expect(emailer.changeEmail).not.toBeCalled();
  });

  test('put /v1/me/email should reject invalid new email', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const password = 'password';
    const newEmail = 'test-2@example.com';
    const user = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      language: 'en',
      passhash: 'hash',
    };
    database.getUser.mockResolvedValueOnce(user);
    emailValidator.validate.mockReturnValueOnce(undefined);
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/email')
      .send({ password, newEmail })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();

    expect(emailValidator.validate).toBeCalledTimes(1);

    expect(bcrypt.compare).not.toBeCalled();
    expect(reqstore.createEmailChangeRequest).not.toBeCalled();
    expect(emailer.changeEmail).not.toBeCalled();
  });

  test('PUT /v1/me/email should reject invalid password', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const password = 'password';
    const newEmail = 'test-2@example.com';
    const user = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      language: 'en',
      passhash: 'hash',
    };
    database.getUser.mockResolvedValueOnce(user);
    emailValidator.validate.mockReturnValueOnce(newEmail);
    bcrypt.compare.mockResolvedValueOnce(false);
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/email')
      .send({ password, newEmail })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid password' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(bcrypt.compare).toBeCalledTimes(1);

    expect(reqstore.createEmailChangeRequest).not.toBeCalled();
    expect(emailer.changeEmail).not.toBeCalled();
  });

  test('PUT /v1/me/email should end corrupted session correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.getUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockRejectedValueOnce(new Error('TEST'));
    sesstore.endSession.mockRejectedValueOnce(new Error('TEST'));
    const password = 'password';
    const newEmail = 'test-2@example.com';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/email')
      .send({ password, newEmail })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);

    expect(emailValidator.validate).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(reqstore.createEmailChangeRequest).not.toBeCalled();
    expect(emailer.changeEmail).not.toBeCalled();
  });

  test('PUT /v1/me/email should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.getUser.mockRejectedValueOnce(new Error('TEST'));
    const password = 'password';
    const newEmail = 'test-2@example.com';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/email')
      .send({ password, newEmail })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
    expect(emailValidator.validate).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(reqstore.createEmailChangeRequest).not.toBeCalled();
    expect(emailer.changeEmail).not.toBeCalled();
  });

  test('PUT /v1/me/password should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const password = 'password';
    const newPassword = 'password2';
    const user = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      language: 'en',
      passhash: 'hash',
    };
    database.getUser.mockResolvedValueOnce(user);
    passwordValidator.validate.mockReturnValueOnce(newPassword);
    bcrypt.compare.mockResolvedValueOnce(true);
    const salt = 'salt';
    bcrypt.genSalt.mockResolvedValueOnce(salt);
    const hash = 'hash';
    bcrypt.hash.mockResolvedValueOnce(hash);
    const modifiedUser = {};
    database.modifyUser.mockResolvedValueOnce(modifiedUser);
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/password')
      .send({ password, newPassword })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.getUser).toBeCalledTimes(1);
    expect(database.getUser).toHaveBeenNthCalledWith(1, sessionData);

    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(passwordValidator.validate).toHaveBeenNthCalledWith(1, newPassword);

    expect(bcrypt.compare).toBeCalledTimes(1);
    expect(bcrypt.compare).toHaveBeenNthCalledWith(1, password, user.passhash);

    expect(bcrypt.genSalt).toBeCalledTimes(1);
    expect(bcrypt.genSalt).toHaveBeenNthCalledWith(1, config.saltRounds);
    expect(bcrypt.hash).toBeCalledTimes(1);
    expect(bcrypt.hash).toHaveBeenNthCalledWith(1, newPassword, salt);

    expect(database.modifyUser).toBeCalledTimes(1);
    expect(database.modifyUser).toHaveBeenNthCalledWith(1, user.id, {
      passhash: hash,
    });

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/password should reject missing session token', async () => {
    const a = await app.initialize();
    const password = 'password';
    const newPassword = 'password2';

    const r = await request(a)
      .put('/v1/me/password')
      .send({ password, newPassword })
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.getUser).not.toBeCalled();
    expect(passwordValidator.validate).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/password should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const password = 'password';
    const newPassword = 'password2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/password')
      .send({ password, newPassword })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.getUser).not.toBeCalled();
    expect(passwordValidator.validate).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/password should reject disappeared user (get)', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const password = 'password';
    const newPassword = 'password2';
    database.getUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/password')
      .send({ password, newPassword })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);

    expect(passwordValidator.validate).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
  });

  test('put /v1/me/password should reject invalid new password', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const password = 'password';
    const newPassword = 'password2';
    const user = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      language: 'en',
      passhash: 'hash',
    };
    database.getUser.mockResolvedValueOnce(user);
    passwordValidator.validate.mockReturnValueOnce(undefined);
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/password')
      .send({ password, newPassword })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(passwordValidator.validate).toBeCalledTimes(1);

    expect(bcrypt.compare).not.toBeCalled();
    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/password should reject invalid password', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const password = 'password';
    const newPassword = 'password2';
    const user = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      language: 'en',
      passhash: 'hash',
    };
    database.getUser.mockResolvedValueOnce(user);
    passwordValidator.validate.mockReturnValueOnce(newPassword);
    bcrypt.compare.mockResolvedValueOnce(false);
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/password')
      .send({ password, newPassword })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid password' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(bcrypt.compare).toBeCalledTimes(1);

    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/password should reject disappeared user (modify)', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const password = 'password';
    const newPassword = 'password2';
    const user = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      language: 'en',
      passhash: 'hash',
    };
    database.getUser.mockResolvedValueOnce(user);
    passwordValidator.validate.mockReturnValueOnce(newPassword);
    bcrypt.compare.mockResolvedValueOnce(true);
    const salt = 'salt';
    bcrypt.genSalt.mockResolvedValueOnce(salt);
    const hash = 'hash';
    bcrypt.hash.mockResolvedValueOnce(hash);
    database.modifyUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/password')
      .send({ password, newPassword })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(bcrypt.compare).toBeCalledTimes(1);
    expect(bcrypt.genSalt).toBeCalledTimes(1);
    expect(bcrypt.hash).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);
  });

  test('PUT /v1/me/password should end corrupted session correctly (get)', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const password = 'password';
    const newPassword = 'password2';
    database.getUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockRejectedValueOnce(new Error('TEST'));
    sesstore.endSession.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/password')
      .send({ password, newPassword })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);

    expect(passwordValidator.validate).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
  });

  test('PUT /v1/me/password should end corrupted session correctly (modify)', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const password = 'password';
    const newPassword = 'password2';
    const user = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      language: 'en',
      passhash: 'hash',
    };
    database.getUser.mockResolvedValueOnce(user);
    passwordValidator.validate.mockReturnValueOnce(newPassword);
    bcrypt.compare.mockResolvedValueOnce(true);
    const salt = 'salt';
    bcrypt.genSalt.mockResolvedValueOnce(salt);
    const hash = 'hash';
    bcrypt.hash.mockResolvedValueOnce(hash);
    database.modifyUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockRejectedValueOnce(new Error('TEST'));
    sesstore.endSession.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/password')
      .send({ password, newPassword })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(passwordValidator.validate).toBeCalledTimes(1);
    expect(bcrypt.compare).toBeCalledTimes(1);
    expect(bcrypt.genSalt).toBeCalledTimes(1);
    expect(bcrypt.hash).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);
  });

  test('PUT /v1/me/password should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const password = 'password';
    const newPassword = 'password2';
    database.getUser.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/password')
      .send({ password, newPassword })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);

    expect(passwordValidator.validate).not.toBeCalled();
    expect(bcrypt.compare).not.toBeCalled();
    expect(bcrypt.genSalt).not.toBeCalled();
    expect(bcrypt.hash).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/language should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const language = 'fi';
    const modifiedUser = {
      id: 'user-id',
      firstName: 'John',
      lastName: 'Random',
      language: 'fi',
      passhash: 'hash',
    };
    database.modifyUser.mockResolvedValueOnce(modifiedUser);
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/language')
      .send({ language })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.modifyUser).toBeCalledTimes(1);
    expect(database.modifyUser).toHaveBeenNthCalledWith(1, sessionData, {
      language,
    });

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/language should reject missing session token', async () => {
    const a = await app.initialize();
    const language = 'fi';

    const r = await request(a)
      .put('/v1/me/language')
      .send({ language })
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/language should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const language = 'fi';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/language')
      .send({ language })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.modifyUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/language should reject invalid language', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const language = 'invalid';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/language')
      .send({ language })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.modifyUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/language should reject disappeared user', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.modifyUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    const language = 'en';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/language')
      .send({ language })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);
  });

  test('PUT /v1/me/language should end corrupted session correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.modifyUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockRejectedValueOnce(new Error('TEST'));
    sesstore.endSession.mockRejectedValueOnce(new Error('TEST'));
    const language = 'en';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/language')
      .send({ language })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);
  });

  test('PUT /v1/me/language should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.modifyUser.mockRejectedValueOnce(new Error('TEST'));
    const language = 'en';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/language')
      .send({ language })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/avatar setting avatar should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const newAvatar = 'new-avatar';
    filestore.copyUploadToImages.mockResolvedValueOnce(newAvatar);
    const modifiedUser = {
      avatar: 'avatar',
      old_avatar: undefined,
    };
    database.modifyUser.mockResolvedValueOnce(modifiedUser);
    const avatarURL = 'avatar-url';
    filestore.getImageURLs.mockResolvedValueOnce([avatarURL]);
    const image = 'avatar-image';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/avatar')
      .send({ image })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual({ avatar: avatarURL });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(filestore.copyUploadToImages).toBeCalledTimes(1);
    expect(filestore.copyUploadToImages).toHaveBeenNthCalledWith(1, image);

    expect(database.modifyUser).toBeCalledTimes(1);
    expect(database.modifyUser).toHaveBeenNthCalledWith(1, sessionData, {
      avatar: newAvatar,
    });

    expect(filestore.deleteImage).not.toBeCalled();

    expect(filestore.getImageURLs).toBeCalledTimes(1);
    expect(filestore.getImageURLs).toHaveBeenNthCalledWith(1, [
      modifiedUser.avatar,
    ]);

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/avatar changing avatar should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const newAvatar = 'new-avatar';
    filestore.copyUploadToImages.mockResolvedValueOnce(newAvatar);
    const modifiedUser = {
      avatar: 'avatar',
      old_avatar: 'avatar-old',
    };
    database.modifyUser.mockResolvedValueOnce(modifiedUser);
    const avatarURL = 'avatar-url';
    filestore.deleteImage.mockResolvedValueOnce(true);
    filestore.getImageURLs.mockResolvedValueOnce([avatarURL]);
    const image = 'avatar-image';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/avatar')
      .send({ image })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual({ avatar: avatarURL });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(filestore.copyUploadToImages).toBeCalledTimes(1);
    expect(filestore.copyUploadToImages).toHaveBeenNthCalledWith(1, image);

    expect(database.modifyUser).toBeCalledTimes(1);
    expect(database.modifyUser).toHaveBeenNthCalledWith(1, sessionData, {
      avatar: newAvatar,
    });

    expect(filestore.deleteImage).toBeCalledTimes(1);
    expect(filestore.deleteImage).toHaveBeenNthCalledWith(
      1,
      modifiedUser.old_avatar
    );

    expect(filestore.getImageURLs).toBeCalledTimes(1);
    expect(filestore.getImageURLs).toHaveBeenNthCalledWith(1, [
      modifiedUser.avatar,
    ]);

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/avatar clearing avatar should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const modifiedUser = {
      avatar: null,
      old_avatar: 'avatar-old',
    };
    database.modifyUser.mockResolvedValueOnce(modifiedUser);
    const avatarURL = 'avatar-url';
    filestore.deleteImage.mockResolvedValueOnce(true);
    filestore.getImageURLs.mockResolvedValueOnce([avatarURL]);
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/avatar')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual({ avatar: null });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(filestore.copyUploadToImages).not.toBeCalled();

    expect(database.modifyUser).toBeCalledTimes(1);
    expect(database.modifyUser).toHaveBeenNthCalledWith(1, sessionData, {
      avatar: null,
    });

    expect(filestore.deleteImage).toBeCalledTimes(1);
    expect(filestore.deleteImage).toHaveBeenNthCalledWith(
      1,
      modifiedUser.old_avatar
    );

    expect(filestore.getImageURLs).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/avatar should reject missing session token', async () => {
    const a = await app.initialize();
    const image = 'avatar-image';

    const r = await request(a)
      .put('/v1/me/avatar')
      .send({ image })
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(filestore.copyUploadToImages).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
    expect(filestore.deleteImage).not.toBeCalled();
    expect(filestore.getImageURLs).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/avatar should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const image = 'avatar-image';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/avatar')
      .send({ image })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(filestore.copyUploadToImages).not.toBeCalled();
    expect(database.modifyUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/avatar should reject not found avatar', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    filestore.copyUploadToImages.mockResolvedValueOnce(undefined);
    const image = 'avatar-image';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/avatar')
      .send({ image })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(filestore.copyUploadToImages).toBeCalledTimes(1);

    expect(database.modifyUser).not.toBeCalled();
    expect(filestore.deleteImage).not.toBeCalled();
    expect(filestore.getImageURLs).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/avatar should reject disappeared user', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const newAvatar = 'new-avatar';
    filestore.copyUploadToImages.mockResolvedValueOnce(newAvatar);
    database.modifyUser.mockResolvedValueOnce(undefined);
    filestore.deleteImage.mockResolvedValueOnce(true);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    const image = 'avatar-image';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/avatar')
      .send({ image })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(filestore.copyUploadToImages).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);

    expect(filestore.deleteImage).toBeCalledTimes(1);
    expect(filestore.deleteImage).toHaveBeenNthCalledWith(1, newAvatar);

    expect(publisher.logout).toBeCalledTimes(1);
    expect(publisher.logout).toHaveBeenNthCalledWith(1, sessionData);

    expect(sesstore.endSession).toBeCalledTimes(1);
    expect(sesstore.endSession).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
      data: sessionData,
    });

    expect(filestore.getImageURLs).not.toBeCalled();
  });

  test('PUT /v1/me/avatar should end corrupted session correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const newAvatar = 'new-avatar';
    filestore.copyUploadToImages.mockResolvedValueOnce(newAvatar);
    database.modifyUser.mockResolvedValueOnce(undefined);
    filestore.deleteImage.mockRejectedValueOnce(new Error('TEST'));
    publisher.logout.mockRejectedValueOnce(new Error('TEST'));
    sesstore.endSession.mockRejectedValueOnce(new Error('TEST'));
    const image = 'avatar-image';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/avatar')
      .send({ image })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(filestore.copyUploadToImages).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);

    expect(filestore.deleteImage).toBeCalledTimes(1);
    expect(filestore.deleteImage).toHaveBeenNthCalledWith(1, newAvatar);

    expect(publisher.logout).toBeCalledTimes(1);
    expect(publisher.logout).toHaveBeenNthCalledWith(1, sessionData);

    expect(sesstore.endSession).toBeCalledTimes(1);
    expect(sesstore.endSession).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
      data: sessionData,
    });

    expect(filestore.getImageURLs).not.toBeCalled();
  });

  test('PUT /v1/me/avatar removing previous avatar image should ignore errors', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const newAvatar = 'new-avatar';
    filestore.copyUploadToImages.mockResolvedValueOnce(newAvatar);
    const modifiedUser = {
      avatar: 'avatar',
      old_avatar: 'avatar-old',
    };
    database.modifyUser.mockResolvedValueOnce(modifiedUser);
    const avatarURL = 'avatar-url';
    filestore.deleteImage.mockRejectedValueOnce(new Error('TEST'));
    filestore.getImageURLs.mockResolvedValueOnce([avatarURL]);
    const image = 'avatar-image';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/avatar')
      .send({ image })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual({ avatar: avatarURL });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(filestore.copyUploadToImages).toBeCalledTimes(1);
    expect(filestore.copyUploadToImages).toHaveBeenNthCalledWith(1, image);

    expect(database.modifyUser).toBeCalledTimes(1);
    expect(database.modifyUser).toHaveBeenNthCalledWith(1, sessionData, {
      avatar: newAvatar,
    });

    expect(filestore.deleteImage).toBeCalledTimes(1);
    expect(filestore.deleteImage).toHaveBeenNthCalledWith(
      1,
      modifiedUser.old_avatar
    );

    expect(filestore.getImageURLs).toBeCalledTimes(1);
    expect(filestore.getImageURLs).toHaveBeenNthCalledWith(1, [
      modifiedUser.avatar,
    ]);

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('PUT /v1/me/avatar should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const newAvatar = 'new-avatar';
    filestore.copyUploadToImages.mockResolvedValueOnce(newAvatar);
    database.modifyUser.mockRejectedValueOnce(new Error('TEST'));
    const image = 'avatar-image';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put('/v1/me/avatar')
      .send({ image })
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(filestore.copyUploadToImages).toBeCalledTimes(1);
    expect(database.modifyUser).toBeCalledTimes(1);

    expect(filestore.deleteImage).not.toBeCalled();
    expect(filestore.getImageURLs).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
  });

  test('POST /v1/me/endpoint should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const endpointRequest = {
      id: 'id',
      expires: 'expires',
    };
    reqstore.createEndpointRequest.mockResolvedValueOnce(endpointRequest);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/me/endpoint')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(201);

    expect(r.body).toEqual(endpointRequest);

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(reqstore.createEndpointRequest).toBeCalledTimes(1);
    expect(reqstore.createEndpointRequest).toHaveBeenNthCalledWith(1, {
      userId: sessionData,
    });
  });

  test('POST /v1/me/endpoint should reject missing session token', async () => {
    const a = await app.initialize();

    const r = await request(a)
      .post('/v1/me/endpoint')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(reqstore.createEndpointRequest).not.toBeCalled();
  });

  test('POST /v1/me/endpoint should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/me/endpoint')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(reqstore.createEndpointRequest).not.toBeCalled();
  });

  test('POST /v1/me/endpoint should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    reqstore.createEndpointRequest.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/me/endpoint')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(reqstore.createEndpointRequest).toBeCalledTimes(1);
  });

  test('POST /v1/images should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const image = 'image';
    filestore.putUploadURL.mockResolvedValueOnce(image);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/images')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(201);

    expect(r.body).toEqual(image);

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(filestore.putUploadURL).toBeCalledTimes(1);
  });

  test('POST /v1/images should reject missing session token', async () => {
    const a = await app.initialize();

    const r = await request(a)
      .post('/v1/images')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(filestore.putUploadURL).not.toBeCalled();
  });

  test('POST /v1/images should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/images')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(filestore.putUploadURL).not.toBeCalled();
  });

  test('POST /v1/images should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    filestore.putUploadURL.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/images')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(filestore.putUploadURL).toBeCalledTimes(1);
  });

  test('DELETE /v1/images/{id} should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    filestore.deleteUpload.mockResolvedValueOnce(true);
    const id = '1234';
    const sessionToken = 'session-token';

    const r = await request(a)
      .delete(`/v1/images/${id}`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(filestore.deleteUpload).toBeCalledTimes(1);
    expect(filestore.deleteUpload).toHaveBeenNthCalledWith(1, id);
  });

  test('DELETE /v1/images/{id} should reject missing session token', async () => {
    const a = await app.initialize();
    const id = '1234';

    const r = await request(a)
      .delete(`/v1/images/${id}`)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(filestore.deleteUpload).not.toBeCalled();
  });

  test('DELETE /v1/images/{id} should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const id = '1234';
    const sessionToken = 'session-token';

    const r = await request(a)
      .delete(`/v1/images/${id}`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(filestore.deleteUpload).not.toBeCalled();
  });

  test('DELETE /v1/images/{id} should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    filestore.deleteUpload.mockRejectedValueOnce(new Error('TEST'));
    const id = '1234';
    const sessionToken = 'session-token';

    const r = await request(a)
      .delete(`/v1/images/${id}`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(filestore.deleteUpload).toBeCalledTimes(1);
  });

  test('POST /v1/images/url should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    filestore.isValidFileId.mockReturnValue(true);
    const imageURLs = ['uno-url', 'dos-url', 'tres-url'];
    filestore.getImageURLs.mockResolvedValueOnce(imageURLs);
    const images = ['uno', 'dos', 'tres'];
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/images/url')
      .send(images)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual(imageURLs);

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(filestore.isValidFileId).toBeCalledTimes(images.length);

    expect(filestore.getImageURLs).toBeCalledTimes(1);
    expect(filestore.getImageURLs).toHaveBeenNthCalledWith(1, images);
  });

  test('POST /v1/images/url should reject missing session token', async () => {
    const a = await app.initialize();
    const images = ['uno', 'dos', 'tres'];

    const r = await request(a)
      .post('/v1/images/url')
      .send(images)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(filestore.isValidFileId).not.toBeCalled();
    expect(filestore.getImageURLs).not.toBeCalled();
  });

  test('POST /v1/images/url should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const images = ['uno', 'dos', 'tres'];
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/images/url')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(images)
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(filestore.isValidFileId).not.toBeCalled();
    expect(filestore.getImageURLs).not.toBeCalled();
  });

  test('POST /v1/images/url should reject non-array input', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    const sessionToken = 'session-token';

    const invalidData = [{}, { foo: 'bar' }];
    for (let i = 0; i < invalidData.length; i += 1) {
      sesstore.sessionData.mockResolvedValueOnce(sessionData);

      const r = await request(a)
        .post('/v1/images/url')
        .set('Content-Type', 'application/json')
        .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
        .set('Accept', 'application/json')
        .send(invalidData[i])
        .expect(400);

      expect(r.body).toEqual({ error: 'Invalid data' });

      expect(sesstore.sessionData).toBeCalled();
      sesstore.sessionData.mockClear();
    }

    expect(filestore.isValidFileId).not.toBeCalled();
    expect(filestore.getImageURLs).not.toBeCalled();
  });

  test('POST /v1/images/url should reject invalid image', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    filestore.isValidFileId.mockReturnValueOnce(false);
    const sessionToken = 'session-token';
    const images = ['uno', 'dos', 'tres'];

    const r = await request(a)
      .post('/v1/images/url')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(images)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalled();
    expect(filestore.isValidFileId).toBeCalledTimes(1);
    expect(filestore.getImageURLs).not.toBeCalled();
  });

  test('POST /v1/images/url should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    filestore.isValidFileId.mockReturnValue(true);
    filestore.getImageURLs.mockRejectedValueOnce(new Error('TEST'));
    const images = ['uno', 'dos', 'tres'];
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/images/url')
      .send(images)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(filestore.getImageURLs).toBeCalledTimes(1);
  });

  test('GET /v1/users should find user', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const email = 'test@example.com';
    emailValidator.validate.mockReturnValueOnce(email);
    const foundUser = {
      id: 'id',
      firstName: 'John',
      lastName: 'Random',
      email,
      avatar: null,
      secret: 'secret',
    };
    database.findUser.mockResolvedValueOnce(foundUser);
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users')
      .query({ email })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual([
      {
        id: foundUser.id,
        firstName: foundUser.firstName,
        lastName: foundUser.lastName,
        email: foundUser.email,
        avatar: foundUser.avatar,
      },
    ]);
    expect(r.body[0].secret).not.toBeDefined();

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.findUser).toBeCalledTimes(1);
    expect(database.findUser).toHaveBeenNthCalledWith(1, email);
  });

  test('GET /v1/users should return empty list not found', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const email = 'test@example.com';
    emailValidator.validate.mockReturnValueOnce(email);
    database.findUser.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users')
      .query({ email })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual([]);

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.findUser).toBeCalledTimes(1);
  });

  test('GET /v1/users should reject missing session token', async () => {
    const a = await app.initialize();
    const email = 'test@example.com';

    const r = await request(a)
      .get('/v1/users')
      .query({ email })
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.findUser).not.toBeCalled();
  });

  test('GET /v1/users should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const email = 'test@example.com';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users')
      .query({ email })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.findUser).not.toBeCalled();
  });

  test('GET /v1/users should reject invalid email', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const email = 'test@example.com';
    emailValidator.validate.mockReturnValueOnce(undefined);
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users')
      .query({ email })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(filestore.getImageURLs).not.toBeCalled();
  });

  test('GET /v1/users should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const email = 'test@example.com';
    emailValidator.validate.mockReturnValueOnce(email);
    database.findUser.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users')
      .query({ email })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.findUser).toBeCalledTimes(1);
  });

  test('POST /v1/users/batch should find users', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidLimit.mockReturnValue(true);
    const foundUsers = [
      {
        id: 'id-1',
        firstName: 'John-1',
        lastName: 'Random-1',
        email: 'test-1@example.com',
        avatar: null,
        secret: 'secret',
      },
      {
        id: 'id-2',
        firstName: 'John-2',
        lastName: 'Random-2',
        email: 'test-2@example.com',
        avatar: null,
        secret: 'secret',
      },
    ];
    database.getUsers.mockResolvedValueOnce(foundUsers);
    const ids = ['id-1', 'id-2'];
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/batch')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(200);

    expect(r.body).toEqual(
      foundUsers.map(u => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
      }))
    );
    expect(r.body[0].secret).not.toBeDefined();
    expect(r.body[1].secret).not.toBeDefined();

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.isValidLimit).toBeCalledTimes(1);
    expect(database.isValidLimit).toHaveBeenNthCalledWith(1, ids.length);

    expect(database.getUsers).toBeCalledTimes(1);
    expect(database.getUsers).toHaveBeenNthCalledWith(1, ids);
  });

  test('POST /v1/users/batch should reject missing session token', async () => {
    const a = await app.initialize();
    const ids = ['id-1', 'id-2'];

    const r = await request(a)
      .post('/v1/users/batch')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .send(ids)
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.isValidLimit).not.toBeCalled();
    expect(database.getUsers).not.toBeCalled();
  });

  test('POST /v1/users/batch should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const ids = ['id-1', 'id-2'];
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/batch')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidLimit).not.toBeCalled();
    expect(database.getUsers).not.toBeCalled();
  });

  test('POST /v1/users/batch should reject non array ids', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const ids = { foo: 'bar' };
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/batch')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.isValidLimit).not.toBeCalled();
    expect(database.getUsers).not.toBeCalled();
  });

  test('POST /v1/users/batch should reject too many ids', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidLimit.mockReturnValue(false);
    const ids = ['id-1', 'id-2'];
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/batch')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidLimit).toBeCalledTimes(1);
    expect(database.getUsers).not.toBeCalled();
  });

  test('POST /v1/users/batch should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidLimit.mockReturnValue(true);
    database.getUsers.mockRejectedValueOnce(new Error('TEST'));
    const ids = ['id-1', 'id-2'];
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/batch')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidLimit).toBeCalledTimes(1);
    expect(database.getUsers).toBeCalledTimes(1);
  });

  test('GET /v1/users/friends should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(true);
    const foundConnections = [
      {
        index: 'index-1',
        id: 'user-id-1',
        firstName: 'John-1',
        lastName: 'Random',
        email: 'test-1@example.com',
        avatar: null,
        secret: 'secret',
      },
      {
        index: 'index-2',
        id: 'user-id-2',
        firstName: 'John-2',
        lastName: 'Random',
        email: 'test-2@example.com',
        avatar: null,
        secret: 'secret',
      },
    ];
    database.getConnections.mockResolvedValueOnce(foundConnections);
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users/friends')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual(
      foundConnections.map(u => ({
        index: u.index,
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
      }))
    );
    expect(r.body[0].secret).not.toBeDefined();
    expect(r.body[1].secret).not.toBeDefined();

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toHaveBeenNthCalledWith(
      1,
      exclusiveStartIndex,
      limit
    );

    expect(database.getConnections).toBeCalledTimes(1);
    expect(database.getConnections).toHaveBeenNthCalledWith(
      1,
      sessionData,
      Number(exclusiveStartIndex),
      Number(limit)
    );
  });

  test('GET /v1/users/friends should work with default parameters', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(true);
    const foundConnections = [
      {
        index: 'index-1',
        id: 'user-id-1',
        firstName: 'John-1',
        lastName: 'Random',
        email: 'test-1@example.com',
        avatar: null,
        secret: 'secret',
      },
      {
        index: 'index-2',
        id: 'user-id-2',
        firstName: 'John-2',
        lastName: 'Random',
        email: 'test-2@example.com',
        avatar: null,
        secret: 'secret',
      },
    ];
    database.getConnections.mockResolvedValueOnce(foundConnections);
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users/friends')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual(
      foundConnections.map(u => ({
        index: u.index,
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
      }))
    );
    expect(r.body[0].secret).not.toBeDefined();
    expect(r.body[1].secret).not.toBeDefined();

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toHaveBeenNthCalledWith(
      1,
      0,
      config.queryLimit
    );

    expect(database.getConnections).toBeCalledTimes(1);
  });

  test('GET /v1/users/friends should reject missing session token', async () => {
    const a = await app.initialize();
    const exclusiveStartIndex = '1';
    const limit = '2';

    const r = await request(a)
      .get('/v1/users/friends')
      .query({ exclusiveStartIndex, limit })
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.isValidIndexAndLimit).not.toBeCalled();
    expect(database.getConnections).not.toBeCalled();
  });

  test('GET /v1/users/friends should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users/friends')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).not.toBeCalled();
    expect(database.getConnections).not.toBeCalled();
  });

  test('GET /v1/users/friends should reject invalid start index and/or limit', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(false);
    const exclusiveStartIndex = '2';
    const limit = '3';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users/friends')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });
    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toHaveBeenNthCalledWith(
      1,
      exclusiveStartIndex,
      limit
    );

    expect(database.getConnections).not.toBeCalled();
  });

  test('GET /v1/users/friends should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(true);
    database.getConnections.mockResolvedValueOnce(new Error('TEST'));
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users/friends')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.getConnections).toBeCalledTimes(1);
  });

  test('GET /v1/users/blocked should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(true);
    const foundBlocked = [
      {
        index: 'index-1',
        id: 'user-id-1',
        firstName: 'John-1',
        lastName: 'Random',
        email: 'test-1@example.com',
        avatar: null,
        secret: 'secret',
      },
      {
        index: 'index-2',
        id: 'user-id-2',
        firstName: 'John-2',
        lastName: 'Random',
        email: 'test-2@example.com',
        avatar: null,
        secret: 'secret',
      },
    ];
    database.getBlocked.mockResolvedValueOnce(foundBlocked);
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users/blocked')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual(
      foundBlocked.map(u => ({
        index: u.index,
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
      }))
    );
    expect(r.body[0].secret).not.toBeDefined();
    expect(r.body[1].secret).not.toBeDefined();

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toHaveBeenNthCalledWith(
      1,
      exclusiveStartIndex,
      limit
    );

    expect(database.getBlocked).toBeCalledTimes(1);
    expect(database.getBlocked).toHaveBeenNthCalledWith(
      1,
      sessionData,
      Number(exclusiveStartIndex),
      Number(limit)
    );
  });

  test('GET /v1/users/blocked should work with default parameters', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(true);
    const foundBlocked = [
      {
        index: 'index-1',
        id: 'user-id-1',
        firstName: 'John-1',
        lastName: 'Random',
        email: 'test-1@example.com',
        avatar: null,
        secret: 'secret',
      },
      {
        index: 'index-2',
        id: 'user-id-2',
        firstName: 'John-2',
        lastName: 'Random',
        email: 'test-2@example.com',
        avatar: null,
        secret: 'secret',
      },
    ];
    database.getBlocked.mockResolvedValueOnce(foundBlocked);
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users/blocked')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual(
      foundBlocked.map(u => ({
        index: u.index,
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
      }))
    );

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toHaveBeenNthCalledWith(
      1,
      0,
      config.queryLimit
    );

    expect(database.getBlocked).toBeCalledTimes(1);
  });

  test('GET /v1/users/blocked should reject missing session token', async () => {
    const a = await app.initialize();
    const exclusiveStartIndex = '1';
    const limit = '2';

    const r = await request(a)
      .get('/v1/users/blocked')
      .query({ exclusiveStartIndex, limit })
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.isValidIndexAndLimit).not.toBeCalled();
    expect(database.getBlocked).not.toBeCalled();
  });

  test('GET /v1/users/blocked should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users/blocked')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).not.toBeCalled();
    expect(database.getBlocked).not.toBeCalled();
  });

  test('GET /v1/users/blocked should reject invalid start index and/or limit', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(false);
    const exclusiveStartIndex = '2';
    const limit = '3';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users/blocked')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });
    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toHaveBeenNthCalledWith(
      1,
      exclusiveStartIndex,
      limit
    );

    expect(database.getBlocked).not.toBeCalled();
  });

  test('GET /v1/users/blocked should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(true);
    database.getBlocked.mockRejectedValueOnce(new Error('TEST'));
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/users/blocked')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.getBlocked).toBeCalledTimes(1);
  });

  test('PUT /v1/users/{id}/blocked should block user', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.addBlocked.mockResolvedValueOnce(true);
    const id = '1234';
    const blocked = true;
    const sessionToken = 'session-token';

    const r = await request(a)
      .put(`/v1/users/${id}/blocked`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ blocked })
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.addBlocked).toBeCalledTimes(1);
    expect(database.addBlocked).toHaveBeenNthCalledWith(1, sessionData, id);
    expect(database.deleteBlocked).not.toBeCalled();
  });

  test('PUT /v1/users/{id}/blocked should unblock user', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.deleteBlocked.mockResolvedValueOnce(true);
    const id = '1234';
    const blocked = false;
    const sessionToken = 'session-token';

    const r = await request(a)
      .put(`/v1/users/${id}/blocked`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ blocked })
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.addBlocked).not.toBeCalled();
    expect(database.deleteBlocked).toBeCalledTimes(1);
    expect(database.deleteBlocked).toHaveBeenNthCalledWith(1, sessionData, id);
  });

  test('PUT /v1/users/{id}/blocked should reject missing session token', async () => {
    const a = await app.initialize();
    const id = '1234';
    const blocked = false;

    const r = await request(a)
      .put(`/v1/users/${id}/blocked`)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .send({ blocked })
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.addBlocked).not.toBeCalled();
    expect(database.deleteBlocked).not.toBeCalled();
  });

  test('PUT /v1/users/{id}/blocked should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';
    const id = '1234';
    const blocked = false;

    const r = await request(a)
      .put(`/v1/users/${id}/blocked`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ blocked })
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.addBlocked).not.toBeCalled();
    expect(database.deleteBlocked).not.toBeCalled();
  });

  test('PUT /v1/users/{id}/blocked should reject not found user', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.addBlocked.mockResolvedValueOnce(false);
    const sessionToken = 'session-token';
    const id = '1234';
    const blocked = true;

    const r = await request(a)
      .put(`/v1/users/${id}/blocked`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ blocked })
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });
    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.addBlocked).toBeCalledTimes(1);
    expect(database.deleteBlocked).not.toBeCalled();
  });

  test('PUT /v1/users/{id}/blocked should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.addBlocked.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';
    const id = '1234';
    const blocked = true;

    const r = await request(a)
      .put(`/v1/users/${id}/blocked`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ blocked })
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.addBlocked).toBeCalledTimes(1);
    expect(database.deleteBlocked).not.toBeCalled();
  });

  test('PUT /v1/users/{id}/unfriend should remove user from friends', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.deleteConnection.mockResolvedValueOnce(true);
    const id = '1234';
    const sessionToken = 'session-token';

    const r = await request(a)
      .put(`/v1/users/${id}/unfriend`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.deleteConnection).toBeCalledTimes(1);
    expect(database.deleteConnection).toHaveBeenNthCalledWith(
      1,
      sessionData,
      id
    );
  });

  test('PUT /v1/users/{id}/unfriend should reject missing session token', async () => {
    const a = await app.initialize();
    const id = '1234';

    const r = await request(a)
      .put(`/v1/users/${id}/unfriend`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.deleteConnection).not.toBeCalled();
  });

  test('PUT /v1/users/{id}/unfriend should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .put(`/v1/users/${id}/unfriend`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.deleteConnection).not.toBeCalled();
  });

  test('PUT /v1/users/{id}/unfriend should reject not found user', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.deleteConnection.mockResolvedValueOnce(false);
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .put(`/v1/users/${id}/unfriend`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.deleteConnection).toBeCalledTimes(1);
  });

  test('PUT /v1/users/{id}/unfriend should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.deleteConnection.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .put(`/v1/users/${id}/unfriend`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.deleteConnection).toBeCalledTimes(1);
  });

  test('POST /v1/users/invite should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const email = 'test@example.com';
    emailValidator.validate.mockReturnValue(email);
    const inviter = { firstName: 'John', lastName: 'Random' };
    database.getUser.mockResolvedValueOnce(inviter);
    database.isIgnored.mockResolvedValueOnce(false);
    const invited = { id: 'user-id', email: 'user-email' };
    const invite = { id: 'invite-id' };
    const i = {
      user: invited,
      invite,
    };
    database.addInvite.mockResolvedValueOnce(i);
    emailer.invitation.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/invite')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ email })
      .expect(202);

    expect(r.body).toEqual({ id: invited.id });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(emailValidator.validate).toHaveBeenNthCalledWith(1, email);

    expect(database.getUser).toBeCalledTimes(1);
    expect(database.getUser).toHaveBeenNthCalledWith(1, sessionData);

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();

    expect(database.isIgnored).toBeCalledTimes(1);
    expect(database.isIgnored).toHaveBeenNthCalledWith(1, email);

    expect(database.addInvite).toBeCalledTimes(1);
    expect(database.addInvite).toHaveBeenNthCalledWith(1, email);

    expect(emailer.invitation).toBeCalledTimes(1);
    expect(emailer.invitation).toHaveBeenNthCalledWith(1, {
      id: invite.id,
      email: invited.email,
      firstName: inviter.firstName,
      lastName: inviter.lastName,
    });
  });

  test('POST /v1/users/invite should not invite existing user', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const email = 'test@example.com';
    emailValidator.validate.mockReturnValue(email);
    const inviter = { firstName: 'John', lastName: 'Random' };
    database.getUser.mockResolvedValueOnce(inviter);
    database.isIgnored.mockResolvedValueOnce(false);
    const invited = { id: 'user-id', email: 'user-email' };
    const i = {
      user: invited,
    };
    database.addInvite.mockResolvedValueOnce(i);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/invite')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ email })
      .expect(202);

    expect(r.body).toEqual({ id: invited.id });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
    expect(database.isIgnored).toBeCalledTimes(1);
    expect(database.addInvite).toBeCalledTimes(1);
    expect(emailer.invitation).not.toBeCalled();
  });

  test('POST /v1/users/invite should reject missing session token', async () => {
    const a = await app.initialize();
    const email = 'test@example.com';

    const r = await request(a)
      .post('/v1/users/invite')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .send({ email })
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(emailValidator.validate).not.toBeCalled();
    expect(database.getUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
    expect(database.isIgnored).not.toBeCalled();
    expect(database.addInvite).not.toBeCalled();
    expect(emailer.invitation).not.toBeCalled();
  });

  test('POST /v1/users/invite should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const email = 'test@example.com';
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/invite')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ email })
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(emailValidator.validate).not.toBeCalled();
    expect(database.getUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
    expect(database.isIgnored).not.toBeCalled();
    expect(database.addInvite).not.toBeCalled();
    expect(emailer.invitation).not.toBeCalled();
  });

  test('POST /v1/users/invite should reject invalid email', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    emailValidator.validate.mockReturnValueOnce(false);
    const email = 'test@example.com';
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/invite')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ email })
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(emailValidator.validate).toBeCalledTimes(1);

    expect(database.getUser).not.toBeCalled();
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
    expect(database.isIgnored).not.toBeCalled();
    expect(database.addInvite).not.toBeCalled();
    expect(emailer.invitation).not.toBeCalled();
  });

  test('POST /v1/users/invite should reject disappeared user', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const email = 'test@example.com';
    emailValidator.validate.mockReturnValueOnce(email);
    database.getUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);

    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/invite')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ email })
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);

    expect(database.isIgnored).not.toBeCalled();
    expect(database.addInvite).not.toBeCalled();
    expect(emailer.invitation).not.toBeCalled();
  });

  test('POST /v1/users/invite should end corrupted session correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const email = 'test@example.com';
    emailValidator.validate.mockReturnValueOnce(email);
    database.getUser.mockResolvedValueOnce(undefined);
    publisher.logout.mockRejectedValueOnce(new Error('TEST'));
    sesstore.endSession.mockRejectedValueOnce(new Error('TEST'));

    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/invite')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ email })
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);

    expect(database.isIgnored).not.toBeCalled();
    expect(database.addInvite).not.toBeCalled();
    expect(emailer.invitation).not.toBeCalled();
  });

  test('POST /v1/users/invite should reject based on do not disturb', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const email = 'test@example.com';
    emailValidator.validate.mockReturnValue(email);
    const inviter = { firstName: 'John', lastName: 'Random' };
    database.getUser.mockResolvedValueOnce(inviter);
    database.isIgnored.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/invite')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ email })
      .expect(409);

    expect(r.body).toEqual({ error: 'Do not disturb' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);

    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();

    expect(database.isIgnored).toBeCalledTimes(1);

    expect(database.addInvite).not.toBeCalled();
    expect(emailer.invitation).not.toBeCalled();
  });

  test('POST /v1/users/invite should reject already invited', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const email = 'test@example.com';
    emailValidator.validate.mockReturnValue(email);
    const inviter = { firstName: 'John', lastName: 'Random' };
    database.getUser.mockResolvedValueOnce(inviter);
    database.isIgnored.mockResolvedValueOnce(false);
    database.addInvite.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/invite')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ email })
      .expect(409);

    expect(r.body).toEqual({ error: 'Already invited' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
    expect(database.isIgnored).toBeCalledTimes(1);
    expect(database.addInvite).toBeCalledTimes(1);
    expect(emailer.invitation).not.toBeCalled();
  });

  test('POST /v1/users/invite should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const email = 'test@example.com';
    emailValidator.validate.mockReturnValue(email);
    database.getUser.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/users/invite')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ email })
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(emailValidator.validate).toBeCalledTimes(1);
    expect(database.getUser).toBeCalledTimes(1);
    expect(publisher.logout).not.toBeCalled();
    expect(sesstore.endSession).not.toBeCalled();
    expect(database.isIgnored).not.toBeCalled();
    expect(database.addInvite).not.toBeCalled();
    expect(emailer.invitation).not.toBeCalled();
  });

  test('POST /v1/postcards should work', async () => {
    const a = await app.initialize();
    const sessionData = 'sender-id';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const sender = { id: 'sender-id' };
    const receiver = { id: 'receiver-id' };
    database.getUsers.mockResolvedValueOnce([sender, receiver]);
    database.isBlocked.mockResolvedValueOnce(false);
    const image = 'image';
    filestore.copyUploadToImages.mockResolvedValueOnce(image);
    const postcard = { id: 'postcard-id' };
    database.addPostcard.mockResolvedValueOnce(postcard);
    publisher.postcardReceived.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';
    const upload = 'upload';
    const message = 'message';
    const location = 'location';

    const r = await request(a)
      .post('/v1/postcards')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ receiver: receiver.id, image: upload, message, location })
      .expect(201);

    expect(r.body).toEqual({ id: postcard.id });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.getUsers).toBeCalledTimes(1);
    expect(database.getUsers).toHaveBeenNthCalledWith(1, [
      sessionData,
      receiver.id,
    ]);

    expect(database.isBlocked).toBeCalledTimes(1);
    expect(database.isBlocked).toHaveBeenNthCalledWith(
      1,
      receiver.id,
      sender.id
    );

    expect(filestore.copyUploadToImages).toBeCalledTimes(1);
    expect(filestore.copyUploadToImages).toHaveBeenNthCalledWith(1, upload);

    expect(database.addPostcard).toBeCalledTimes(1);
    expect(database.addPostcard).toHaveBeenNthCalledWith(1, {
      sender: sender.id,
      receiver: receiver.id,
      message,
      image,
      location,
    });

    expect(publisher.postcardReceived).toBeCalledTimes(1);
    expect(publisher.postcardReceived).toHaveBeenNthCalledWith(
      1,
      receiver.id,
      postcard.id
    );
  });

  test('POST /v1/postcards should ignore error with events', async () => {
    const a = await app.initialize();
    const sessionData = 'sender-id';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const sender = { id: 'sender-id' };
    const receiver = { id: 'receiver-id' };
    database.getUsers.mockResolvedValueOnce([sender, receiver]);
    database.isBlocked.mockResolvedValueOnce(false);
    const image = 'image';
    filestore.copyUploadToImages.mockResolvedValueOnce(image);
    const postcard = { id: 'postcard-id' };
    database.addPostcard.mockResolvedValueOnce(postcard);
    publisher.postcardReceived.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';
    const upload = 'upload';
    const message = 'message';
    const location = 'location';

    const r = await request(a)
      .post('/v1/postcards')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ receiver: receiver.id, image: upload, message, location })
      .expect(201);

    expect(r.body).toEqual({ id: postcard.id });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUsers).toBeCalledTimes(1);
    expect(database.isBlocked).toBeCalledTimes(1);
    expect(filestore.copyUploadToImages).toBeCalledTimes(1);
    expect(database.addPostcard).toBeCalledTimes(1);
    expect(publisher.postcardReceived).toBeCalledTimes(1);
  });

  test('POST /v1/postcards should reject missing session token', async () => {
    const a = await app.initialize();
    const receiver = { id: 'receiver-id' };
    const upload = 'upload';
    const message = 'message';
    const location = 'location';

    const r = await request(a)
      .post('/v1/postcards')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .send({ receiver: receiver.id, image: upload, message, location })
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.getUsers).not.toBeCalled();
    expect(database.isBlocked).not.toBeCalled();
    expect(filestore.copyUploadToImages).not.toBeCalled();
    expect(database.addPostcard).not.toBeCalled();
    expect(publisher.postcardReceived).not.toBeCalled();
  });

  test('POST /v1/postcards should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const receiver = { id: 'receiver-id' };
    const upload = 'upload';
    const message = 'message';
    const location = 'location';
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/postcards')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ receiver: receiver.id, image: upload, message, location })
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.getUsers).not.toBeCalled();
    expect(database.isBlocked).not.toBeCalled();
    expect(filestore.copyUploadToImages).not.toBeCalled();
    expect(database.addPostcard).not.toBeCalled();
    expect(publisher.postcardReceived).not.toBeCalled();
  });

  test('POST /v1/postcards should reject disappeared sender', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const receiver = { id: 'receiver-id' };
    database.getUsers.mockResolvedValueOnce([receiver]);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';
    const upload = 'upload';
    const message = 'message';
    const location = 'location';

    const r = await request(a)
      .post('/v1/postcards')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ receiver: receiver.id, image: upload, message, location })
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUsers).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);

    expect(database.isBlocked).not.toBeCalled();
    expect(filestore.copyUploadToImages).not.toBeCalled();
    expect(database.addPostcard).not.toBeCalled();
    expect(publisher.postcardReceived).not.toBeCalled();
  });

  test('POST /v1/postcards should reject disappeared sender and receiver', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.getUsers.mockResolvedValueOnce([]);
    publisher.logout.mockResolvedValueOnce(true);
    sesstore.endSession.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';
    const receiver = { id: 'receiver-id' };
    const upload = 'upload';
    const message = 'message';
    const location = 'location';

    const r = await request(a)
      .post('/v1/postcards')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ receiver: receiver.id, image: upload, message, location })
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUsers).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);

    expect(database.isBlocked).not.toBeCalled();
    expect(filestore.copyUploadToImages).not.toBeCalled();
    expect(database.addPostcard).not.toBeCalled();
    expect(publisher.postcardReceived).not.toBeCalled();
  });

  test('POST /v1/postcards should end corrupted session correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.getUsers.mockResolvedValueOnce([]);
    publisher.logout.mockRejectedValueOnce(new Error('TEST'));
    sesstore.endSession.mockRejectedValueOnce(new Error('TEST'));
    const receiver = { id: 'receiver-id' };
    const sessionToken = 'session-token';
    const upload = 'upload';
    const message = 'message';
    const location = 'location';

    const r = await request(a)
      .post('/v1/postcards')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ receiver: receiver.id, image: upload, message, location })
      .expect(409);

    expect(r.body).toEqual({ error: 'User not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUsers).toBeCalledTimes(1);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(sesstore.endSession).toBeCalledTimes(1);

    expect(database.isBlocked).not.toBeCalled();
    expect(filestore.copyUploadToImages).not.toBeCalled();
    expect(database.addPostcard).not.toBeCalled();
    expect(publisher.postcardReceived).not.toBeCalled();
  });

  test('POST /v1/postcards should reject not found receiver', async () => {
    const a = await app.initialize();
    const sessionData = 'sender-id';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const sender = { id: sessionData };
    const receiver = { id: 'receiver-id' };
    database.getUsers.mockResolvedValueOnce([sender]);
    const sessionToken = 'session-token';
    const upload = 'upload';
    const message = 'message';
    const location = 'location';

    const r = await request(a)
      .post('/v1/postcards')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ receiver: receiver.id, image: upload, message, location })
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUsers).toBeCalledTimes(1);

    expect(database.isBlocked).not.toBeCalled();
    expect(filestore.copyUploadToImages).not.toBeCalled();
    expect(database.addPostcard).not.toBeCalled();
    expect(publisher.postcardReceived).not.toBeCalled();
  });

  test('POST /v1/postcards should reject blocked user', async () => {
    const a = await app.initialize();
    const sessionData = 'sender-id';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const sender = { id: sessionData };
    const receiver = { id: 'receiver-id' };
    database.getUsers.mockResolvedValueOnce([sender, receiver]);
    database.isBlocked.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';
    const upload = 'upload';
    const message = 'message';
    const location = 'location';

    const r = await request(a)
      .post('/v1/postcards')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ receiver: receiver.id, image: upload, message, location })
      .expect(403);

    expect(r.body).toEqual({ error: 'Blocked' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUsers).toBeCalledTimes(1);
    expect(database.isBlocked).toBeCalledTimes(1);

    expect(filestore.copyUploadToImages).not.toBeCalled();
    expect(database.addPostcard).not.toBeCalled();
    expect(publisher.postcardReceived).not.toBeCalled();
  });

  test('POST /v1/postcards should reject not found image', async () => {
    const a = await app.initialize();
    const sessionData = 'sender-id';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const sender = { id: sessionData };
    const receiver = { id: 'receiver-id' };
    database.getUsers.mockResolvedValueOnce([sender, receiver]);
    database.isBlocked.mockResolvedValueOnce(false);
    filestore.copyUploadToImages.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';
    const upload = 'upload';
    const message = 'message';
    const location = 'location';

    const r = await request(a)
      .post('/v1/postcards')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ receiver: receiver.id, image: upload, message, location })
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUsers).toBeCalledTimes(1);
    expect(database.isBlocked).toBeCalledTimes(1);
    expect(filestore.copyUploadToImages).toBeCalledTimes(1);

    expect(database.addPostcard).not.toBeCalled();
    expect(publisher.postcardReceived).not.toBeCalled();
  });

  test('POST /v1/postcards should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'sender-id';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const receiver = { id: 'receiver-id' };
    database.getUsers.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';
    const upload = 'upload';
    const message = 'message';
    const location = 'location';

    const r = await request(a)
      .post('/v1/postcards')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send({ receiver: receiver.id, image: upload, message, location })
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.getUsers).toBeCalledTimes(1);

    expect(database.isBlocked).not.toBeCalled();
    expect(filestore.isValidFileId).not.toBeCalled();
    expect(filestore.copyUploadToImages).not.toBeCalled();
    expect(database.addPostcard).not.toBeCalled();
    expect(publisher.postcardReceived).not.toBeCalled();
  });

  test('POST /v1/postcards/batch should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidLimit.mockReturnValueOnce(true);
    const postcards = [
      {
        id: 'id-1',
        sender: 'sender-1',
        receiver: 'receiver-1',
        image: 'image-1',
        message: 'message-1',
        location: 'location-1',
        created: 'created-1',
        read: 'read-1',
        secret: 'secret-1',
      },
      {
        id: 'id-2',
        sender: 'sender-2',
        receiver: 'receiver-2',
        image: 'image-2',
        message: 'message-2',
        location: 'location-2',
        created: 'created-2',
        read: 'read-2',
        secret: 'secret-2',
      },
    ];
    database.getPostcards.mockResolvedValueOnce(postcards);
    const ids = ['id-1', 'id-2'];
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/postcards/batch')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(200);

    expect(r.body).toEqual(
      postcards.map(p => ({
        id: p.id,
        sender: p.sender,
        receiver: p.receiver,
        image: p.image,
        message: p.message,
        location: p.location,
        created: p.created,
        read: p.read,
      }))
    );
    expect(r.body[0].secret).not.toBeDefined();
    expect(r.body[1].secret).not.toBeDefined();

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.isValidLimit).toBeCalledTimes(1);

    expect(database.getPostcards).toBeCalledTimes(1);
    expect(database.getPostcards).toHaveBeenNthCalledWith(1, sessionData, ids);
  });

  test('POST /v1/postcards/batch should reject missing session token', async () => {
    const a = await app.initialize();
    const ids = ['id-1', 'id-2'];

    const r = await request(a)
      .post('/v1/postcards/batch')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .send(ids)
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.isValidIndex).not.toBeCalled();
    expect(database.getPostcards).not.toBeCalled();
  });

  test('POST /v1/postcards/batch should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';
    const ids = ['id-1', 'id-2'];

    const r = await request(a)
      .post('/v1/postcards/batch')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidIndex).not.toBeCalled();
    expect(database.getPostcards).not.toBeCalled();
  });

  test('POST /v1/postcards/batch should reject non-array data', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const sessionToken = 'session-token';
    const ids = { foo: 'bar' };

    const r = await request(a)
      .post('/v1/postcards/batch')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidIndex).not.toBeCalled();
    expect(database.getPostcards).not.toBeCalled();
  });

  test('POST /v1/postcards/batch should reject too many ids', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidLimit.mockReturnValueOnce(false);
    const sessionToken = 'session-token';
    const ids = ['id-1', 'id-2'];

    const r = await request(a)
      .post('/v1/postcards/batch')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidLimit).toBeCalledTimes(1);
    expect(database.getPostcards).not.toBeCalled();
  });

  test('POST /v1/postcards/batch should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidLimit.mockReturnValueOnce(true);
    database.getPostcards.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';
    const ids = ['id-1', 'id-2'];

    const r = await request(a)
      .post('/v1/postcards/batch')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidLimit).toBeCalledTimes(1);
    expect(database.getPostcards).toBeCalledTimes(1);
  });

  test('POST /v1/postcards/batch-read should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidLimit.mockReturnValue(true);
    const postcards = [
      {
        id: 'id-1',
        sender: 'sender-1',
        receiver: 'receiver-1',
        image: 'image-1',
        message: 'message-1',
        location: 'location-1',
        created: 'created-1',
        read: 'read-1',
        secret: 'secret-1',
      },
      {
        id: 'id-2',
        sender: 'sender-2',
        receiver: 'receiver-2',
        image: 'image-2',
        message: 'message-2',
        location: 'location-2',
        created: 'created-2',
        read: 'read-2',
        secret: 'secret-2',
      },
    ];
    database.getPostcards.mockResolvedValueOnce(postcards);
    const ids = ['id-1', 'id-2'];
    const sessionToken = 'session-token';

    const r = await request(a)
      .post('/v1/postcards/batch-read')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(200);

    expect(r.body).toEqual(
      postcards.map(p => ({
        id: p.id,
        read: p.read,
      }))
    );
    expect(r.body[0].secret).not.toBeDefined();
    expect(r.body[1].secret).not.toBeDefined();

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.isValidLimit).toBeCalledTimes(1);

    expect(database.getPostcards).toBeCalledTimes(1);
    expect(database.getPostcards).toHaveBeenNthCalledWith(1, sessionData, ids);
  });

  test('POST /v1/postcards/batch-read should reject missing session token', async () => {
    const a = await app.initialize();
    const ids = ['id-1', 'id-2'];

    const r = await request(a)
      .post('/v1/postcards/batch-read')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .send(ids)
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.isValidLimit).not.toBeCalled();
    expect(database.getPostcards).not.toBeCalled();
  });

  test('POST /v1/postcards/batch-read should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';
    const ids = ['id-1', 'id-2'];

    const r = await request(a)
      .post('/v1/postcards/batch-read')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidLimit).not.toBeCalled();
    expect(database.getPostcards).not.toBeCalled();
  });

  test('POST /v1/postcards/batch-read should reject non-array ids', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const sessionToken = 'session-token';
    const ids = { foo: 'bar' };

    const r = await request(a)
      .post('/v1/postcards/batch-read')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidLimit).not.toBeCalled();
    expect(database.getPostcards).not.toBeCalled();
  });

  test('POST /v1/postcards/batch-read should reject too many ids', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidLimit.mockReturnValueOnce(false);
    const sessionToken = 'session-token';
    const ids = ['id-1', 'id-2'];

    const r = await request(a)
      .post('/v1/postcards/batch-read')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidLimit).toBeCalledTimes(1);
    expect(database.getPostcards).not.toBeCalled();
  });

  test('POST /v1/postcards/batch-read should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidLimit.mockReturnValue(true);
    database.getPostcards.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';
    const ids = ['id-1', 'id-2'];

    const r = await request(a)
      .post('/v1/postcards/batch-read')
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .send(ids)
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidLimit).toBeCalledTimes(1);
    expect(database.getPostcards).toBeCalledTimes(1);
  });

  test('GET /v1/postcards/inbox should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(true);
    const foundInbox = [
      {
        index: 'index-1',
        postcard: 'postcard-id-1',
        secret: 'secret',
      },
      {
        index: 'index-2',
        postcard: 'postcard-id-2',
        secret: 'secret',
      },
    ];
    database.getInbox.mockResolvedValueOnce(foundInbox);
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/postcards/inbox')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual(
      foundInbox.map(p => ({
        index: p.index,
        postcard: p.postcard,
      }))
    );
    expect(r.body[0].secret).not.toBeDefined();
    expect(r.body[1].secret).not.toBeDefined();

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toHaveBeenNthCalledWith(
      1,
      exclusiveStartIndex,
      limit
    );

    expect(database.getInbox).toBeCalledTimes(1);
    expect(database.getInbox).toHaveBeenNthCalledWith(
      1,
      sessionData,
      Number(exclusiveStartIndex),
      Number(limit)
    );
  });

  test('GET /v1/postcards/inbox should work with default parameters', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(true);
    const foundInbox = [
      {
        index: 'index-1',
        postcard: 'postcard-id-1',
        secret: 'secret',
      },
      {
        index: 'index-2',
        postcard: 'postcard-id-2',
        secret: 'secret',
      },
    ];
    database.getInbox.mockResolvedValueOnce(foundInbox);
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/postcards/inbox')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual(
      foundInbox.map(p => ({
        index: p.index,
        postcard: p.postcard,
      }))
    );

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toHaveBeenNthCalledWith(
      1,
      0,
      config.queryLimit
    );

    expect(database.getInbox).toBeCalledTimes(1);
  });

  test('GET /v1/postcards/inbox should reject missing session token', async () => {
    const a = await app.initialize();
    const exclusiveStartIndex = '1';
    const limit = '2';

    const r = await request(a)
      .get('/v1/postcards/inbox')
      .query({ exclusiveStartIndex, limit })
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.isValidIndexAndLimit).not.toBeCalled();
    expect(database.getInbox).not.toBeCalled();
  });

  test('GET /v1/postcards/inbox should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/postcards/inbox')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).not.toBeCalled();
    expect(database.getInbox).not.toBeCalled();
  });

  test('GET /v1/postcards/inbox should reject invalid start index and/or limit', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(false);
    const exclusiveStartIndex = '2';
    const limit = '3';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/postcards/inbox')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });
    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toHaveBeenNthCalledWith(
      1,
      exclusiveStartIndex,
      limit
    );

    expect(database.getInbox).not.toBeCalled();
  });

  test('GET /v1/postcards/inbox should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(true);
    database.getInbox.mockRejectedValueOnce(new Error('TEST'));
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/postcards/inbox')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.getInbox).toBeCalledTimes(1);
  });

  test('DELETE /v1/postcards/inbox/{index} should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.removeFromInbox.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';
    const index = '1234';

    const r = await request(a)
      .delete(`/v1/postcards/inbox/${index}`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.removeFromInbox).toBeCalledTimes(1);
    expect(database.removeFromInbox).toHaveBeenNthCalledWith(
      1,
      sessionData,
      index
    );
  });

  test('DELETE /v1/postcards/inbox/{index} should reject missing session token', async () => {
    const a = await app.initialize();
    const index = '1234';

    const r = await request(a)
      .delete(`/v1/postcards/inbox/${index}`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.removeFromInbox).not.toBeCalled();
  });

  test('DELETE /v1/postcards/inbox/{index} should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';
    const index = '1234';

    const r = await request(a)
      .delete(`/v1/postcards/inbox/${index}`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.removeFromInbox).not.toBeCalled();
  });

  test('DELETE /v1/postcards/inbox/{index} should reject not found index', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.removeFromInbox.mockResolvedValueOnce(false);
    const sessionToken = 'session-token';
    const index = '1234';

    const r = await request(a)
      .delete(`/v1/postcards/inbox/${index}`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.removeFromInbox).toBeCalledTimes(1);
  });

  test('DELETE /v1/postcards/inbox/{index} should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.removeFromInbox.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';
    const index = '1234';

    const r = await request(a)
      .delete(`/v1/postcards/inbox/${index}`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.removeFromInbox).toBeCalledTimes(1);
  });

  test('PUT /v1/postcards/{id}/read should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const postcard = {
      id: 'postcard-id',
      sender: 'sender-id',
    };
    database.setAsRead.mockResolvedValueOnce(postcard);
    publisher.postcardDelivered.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .put(`/v1/postcards/${id}/read`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.setAsRead).toBeCalledTimes(1);
    expect(database.setAsRead).toHaveBeenNthCalledWith(1, sessionData, id);

    expect(publisher.postcardDelivered).toBeCalledTimes(1);
    expect(publisher.postcardDelivered).toHaveBeenNthCalledWith(
      1,
      postcard.sender,
      postcard.id
    );
  });

  test('PUT /v1/postcards/{id}/read should ignore error with events', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const postcard = {
      id: 'postcard-id',
      sender: 'sender-id',
    };
    database.setAsRead.mockResolvedValueOnce(postcard);
    publisher.postcardDelivered.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .put(`/v1/postcards/${id}/read`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.setAsRead).toBeCalledTimes(1);
    expect(publisher.postcardDelivered).toBeCalledTimes(1);
  });

  test('PUT /v1/postcards/{id}/read should reject missing session token', async () => {
    const a = await app.initialize();
    const id = '1234';

    const r = await request(a)
      .put(`/v1/postcards/${id}/read`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.setAsRead).not.toBeCalled();
    expect(publisher.postcardDelivered).not.toBeCalled();
  });

  test('PUT /v1/postcards/{id}/read should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .put(`/v1/postcards/${id}/read`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.setAsRead).not.toBeCalled();
    expect(publisher.postcardDelivered).not.toBeCalled();
  });

  test('PUT /v1/postcards/{id}/read should reject not found id', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.setAsRead.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .put(`/v1/postcards/${id}/read`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.setAsRead).toBeCalledTimes(1);
    expect(publisher.postcardDelivered).not.toBeCalled();
  });

  test('PUT /v1/postcards/{id}/read should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.setAsRead.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .put(`/v1/postcards/${id}/read`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.setAsRead).toBeCalledTimes(1);
    expect(publisher.postcardDelivered).not.toBeCalled();
  });

  test('POST /v1/postcards/{id}/connect should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const connection = { user: 'user-id', sender: 'sender-id' };
    database.connectWithSender.mockResolvedValueOnce(connection);
    publisher.setAsFriend.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .post(`/v1/postcards/${id}/connect`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.connectWithSender).toBeCalledTimes(1);
    expect(database.connectWithSender).toHaveBeenNthCalledWith(
      1,
      sessionData,
      id
    );

    expect(publisher.setAsFriend).toBeCalledTimes(1);
    expect(publisher.setAsFriend).toHaveBeenNthCalledWith(
      1,
      connection.sender,
      connection.user
    );
  });

  test('POST /v1/postcards/{id}/connect should ignore error with events', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    const connection = { user: 'user-id', sender: 'sender-id' };
    database.connectWithSender.mockResolvedValueOnce(connection);
    publisher.setAsFriend.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .post(`/v1/postcards/${id}/connect`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.connectWithSender).toBeCalledTimes(1);
    expect(publisher.setAsFriend).toBeCalledTimes(1);
  });

  test('POST /v1/postcards/{id}/connect should reject missing session token', async () => {
    const a = await app.initialize();
    const id = '1234';

    const r = await request(a)
      .post(`/v1/postcards/${id}/connect`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.connectWithSender).not.toBeCalled();
    expect(publisher.setAsFriend).not.toBeCalled();
  });

  test('POST /v1/postcards/{id}/connect should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .post(`/v1/postcards/${id}/connect`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.connectWithSender).not.toBeCalled();
    expect(publisher.setAsFriend).not.toBeCalled();
  });

  test('POST /v1/postcards/{id}/connect should reject not found id', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.connectWithSender.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .post(`/v1/postcards/${id}/connect`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.connectWithSender).toBeCalledTimes(1);
    expect(publisher.setAsFriend).not.toBeCalled();
  });

  test('POST /v1/postcards/{id}/connect should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.connectWithSender.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';
    const id = '1234';

    const r = await request(a)
      .post(`/v1/postcards/${id}/connect`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.connectWithSender).toBeCalledTimes(1);
    expect(publisher.setAsFriend).not.toBeCalled();
  });

  test('GET /v1/postcards/sent should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(true);
    const foundSent = [
      {
        index: 'index-1',
        postcard: 'postcard-id-1',
        secret: 'secret',
      },
      {
        index: 'index-2',
        postcard: 'postcard-id-2',
        secret: 'secret',
      },
    ];
    database.getSent.mockResolvedValueOnce(foundSent);
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/postcards/sent')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual(
      foundSent.map(p => ({
        index: p.index,
        postcard: p.postcard,
      }))
    );
    expect(r.body[0].secret).not.toBeDefined();
    expect(r.body[1].secret).not.toBeDefined();

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toHaveBeenNthCalledWith(
      1,
      exclusiveStartIndex,
      limit
    );

    expect(database.getSent).toBeCalledTimes(1);
    expect(database.getSent).toHaveBeenNthCalledWith(
      1,
      sessionData,
      Number(exclusiveStartIndex),
      Number(limit)
    );
  });

  test('GET /v1/postcards/sent should work with default parameters', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(true);
    const foundSent = [
      {
        index: 'index-1',
        postcard: 'postcard-id-1',
        secret: 'secret',
      },
      {
        index: 'index-2',
        postcard: 'postcard-id-2',
        secret: 'secret',
      },
    ];
    database.getSent.mockResolvedValueOnce(foundSent);
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/postcards/sent')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(200);

    expect(r.body).toEqual(
      foundSent.map(p => ({
        index: p.index,
        postcard: p.postcard,
      }))
    );

    expect(sesstore.sessionData).toBeCalledTimes(1);

    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toHaveBeenNthCalledWith(
      1,
      0,
      config.queryLimit
    );

    expect(database.getSent).toBeCalledTimes(1);
  });

  test('GET /v1/postcards/sent should reject missing session token', async () => {
    const a = await app.initialize();
    const exclusiveStartIndex = '1';
    const limit = '2';

    const r = await request(a)
      .get('/v1/postcards/sent')
      .query({ exclusiveStartIndex, limit })
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.isValidIndexAndLimit).not.toBeCalled();
    expect(database.getSent).not.toBeCalled();
  });

  test('GET /v1/postcards/sent should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/postcards/sent')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).not.toBeCalled();
    expect(database.getSent).not.toBeCalled();
  });

  test('GET /v1/postcards/sent should reject invalid start index and/or limit', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(false);
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/postcards/sent')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(400);

    expect(r.body).toEqual({ error: 'Invalid data' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.getSent).not.toBeCalled();
  });

  test('GET /v1/postcards/sent should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.isValidIndexAndLimit.mockReturnValueOnce(true);
    database.getSent.mockRejectedValueOnce(new Error('TEST'));
    const exclusiveStartIndex = '1';
    const limit = '2';
    const sessionToken = 'session-token';

    const r = await request(a)
      .get('/v1/postcards/sent')
      .query({ exclusiveStartIndex, limit })
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.isValidIndexAndLimit).toBeCalledTimes(1);
    expect(database.getSent).toBeCalledTimes(1);
  });

  test('DELETE /v1/postcards/sent/{index} should work', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.removeFromSent.mockResolvedValueOnce(true);
    const sessionToken = 'session-token';
    const index = '1234';

    const r = await request(a)
      .delete(`/v1/postcards/sent/${index}`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(204);

    expect(r.body).toEqual({});

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
      token: sessionToken,
    });

    expect(database.removeFromSent).toBeCalledTimes(1);
    expect(database.removeFromSent).toHaveBeenNthCalledWith(
      1,
      sessionData,
      index
    );
  });

  test('DELETE /v1/postcards/sent/{index} should reject missing session token', async () => {
    const a = await app.initialize();
    const index = '1234';

    const r = await request(a)
      .delete(`/v1/postcards/sent/${index}`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).not.toBeCalled();
    expect(database.removeFromSent).not.toBeCalled();
  });

  test('DELETE /v1/postcards/sent/{index} should reject not found session', async () => {
    const a = await app.initialize();
    sesstore.sessionData.mockResolvedValueOnce(undefined);
    const sessionToken = 'session-token';
    const index = '1234';

    const r = await request(a)
      .delete(`/v1/postcards/sent/${index}`)
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(403);

    expect(r.body).toEqual({ error: 'Invalid session' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.removeFromSent).not.toBeCalled();
  });

  test('DELETE /v1/postcards/sent/{index} should reject not found index', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.removeFromSent.mockResolvedValueOnce(false);
    const sessionToken = 'session-token';
    const index = '1234';

    const r = await request(a)
      .delete(`/v1/postcards/sent/${index}`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(404);

    expect(r.body).toEqual({ error: 'Not found' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.removeFromSent).toBeCalledTimes(1);
  });

  test('DELETE /v1/postcards/sent/{index} should report internal service error correctly', async () => {
    const a = await app.initialize();
    const sessionData = 'session-data';
    sesstore.sessionData.mockResolvedValueOnce(sessionData);
    database.removeFromSent.mockRejectedValueOnce(new Error('TEST'));
    const sessionToken = 'session-token';
    const index = '1234';

    const r = await request(a)
      .delete(`/v1/postcards/sent/${index}`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `POSTCARD-TOKEN token="${sessionToken}"`)
      .set('Accept', 'application/json')
      .expect(500);

    expect(r.body).toEqual({ error: 'Internal service error' });

    expect(sesstore.sessionData).toBeCalledTimes(1);
    expect(database.removeFromSent).toBeCalledTimes(1);
  });
});
