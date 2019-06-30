/*
 *
 */
/* eslint-disable object-shorthand, func-names */

const superagent = require('superagent');
const request = require('supertest');
const uuidv4 = require('uuid/v4');
const fs = require('fs');
const http = require('http');
const https = require('https');
const tmp = require('tmp');
const streamEqual = require('stream-equal');
const WebSocket = require('ws');

let ADDRESS;
let ENDPOINT_ADDRESS;

const UID_LENGTH = 36;
let userCounter = 1;
let postcardCounter = 1;

class MessageBuffer {
  constructor() {
    this.buffer = [];
    this.subscribers = [];
  }

  subscribe(sub) {
    this.subscribers.push(sub);
  }

  unsubscribe(sub) {
    this.subscribers = this.subscribers.filter(s => s !== sub);
  }

  push(data) {
    this.buffer.push(data);
    this.subscribers.forEach(s => s(data));
  }

  messages() {
    return this.buffer;
  }
}

module.exports = {
  initialize: function(
    options = {
      ADDRESS: 'http://127.0.0.1:4000/v1',
      ENDPOINT_ADDRESS: 'ws://localhost:4000/v1/endpoints',
    }
  ) {
    ({ ADDRESS, ENDPOINT_ADDRESS } = options);
  },
  agent: function() {
    return superagent.agent();
  },
  supertest: request,

  sessionToken: function sessionToken({ token }) {
    return `POSTCARD-TOKEN token="${token}"`;
  },

  request: function() {
    return request(ADDRESS);
  },

  endpointAddress: function(id) {
    const ep = `${ENDPOINT_ADDRESS}/${id}`;
    return ep;
  },

  objectWithoutKey: (obj, key) => {
    const { [key]: deletedKey, ...otherKeys } = obj;
    return otherKeys;
  },

  sleep: millis => {
    return new Promise(resolve => {
      setTimeout(resolve, millis);
    });
  },

  parseJSON: function parseJSON(s) {
    try {
      return JSON.parse(s);
    } catch (e) {
      /* */
    }
    return s;
  },

  randomString: function randomString(length) {
    return [...Array(length)]
      .map(() => (~~(Math.random() * 36)).toString(36)) // eslint-disable-line no-bitwise
      .join('');
  },

  randomEmail: function randomEmail() {
    return `${this.randomString(12)}@example.com`;
  },

  randomPassword: function randomPassword() {
    return `aA1-${this.randomString(8)}`;
  },

  randomId: function randomId() {
    return uuidv4();
  },

  randomUserId: function randomUserId() {
    return uuidv4();
  },

  randomPostcardId: function randomPostcardId() {
    return uuidv4();
  },

  randomInviteId: function randomInviteId() {
    return uuidv4();
  },

  randomFileId: function randomFileId() {
    return uuidv4();
  },

  randomEndpointId: function randomEndpointId() {
    return uuidv4();
  },

  shuffle: array => {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  unique: array => {
    return [...new Set(array)];
  },

  sortedIds: function sortIds(objects) {
    return objects.map(u => u.id).sort();
  },

  randomUser: function randomUser(o = {}) {
    const firstName = 'John';
    const lastName = `Random-${userCounter}`;
    const email = this.randomEmail();
    const password = this.randomPassword();
    const language = 'en';
    userCounter += 1;
    return { firstName, lastName, email, password, language, ...o };
  },

  randomPostcard: function randomPostcad(receiver, image) {
    const message = `${postcardCounter}-${this.randomString(32)}`;
    const location = this.randomString(16);
    postcardCounter += 1;
    return {
      receiver: receiver.id,
      image: image.id,
      message,
      location,
    };
  },

  tmpFile: function tempFile() {
    return tmp.fileSync();
  },

  compareFiles: async function compareFiles(file1, file2) {
    const s1 = fs.createReadStream(file1.name);
    const s2 = fs.createReadStream(file2.name);
    return streamEqual(s1, s2);
  },

  sessionHeaders: function sessionHeaders(session) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (session) {
      headers.Authorization = this.sessionToken(session);
    }
    return headers;
  },

  createSession: async function createSession() {
    const user = await this.devCreateUser();
    const session = await this.login(user);
    return { user, session };
  },

  deleteSession: async function deleteSession(s) {
    const { user, session } = s;
    await this.logout(session);
    await this.devDeleteUser(user);
  },

  testInvalidSessionsWith: async function testInvalidSessionsWith(f) {
    const invalidSessions = [undefined, { foo: 'bar' }, { token: 'bar' }];
    for (let i = 0; i < invalidSessions.length; i += 1) {
      const r = await f(invalidSessions[i]);
      expect(r).not.toBeDefined();
    }
  },

  putFileToURL: function putFileToUrl(url, file) {
    const stat = fs.statSync(file.name);
    const stream = fs.createReadStream(file.name);
    const requ = url.toLowerCase().startsWith('https://')
      ? https.request
      : http.request;

    return new Promise((resolve, reject) => {
      const r = requ(
        url,
        {
          method: 'PUT',
          headers: {
            // 'Content-Type': file.contentType,
            'Content-Length': stat.size,
          },
        },
        res => {
          res.on('data', () => {});
          res.on('end', () => {
            resolve();
          });
          res.on('error', () => {
            reject();
          });
        }
      );
      stream.pipe(r);
    });
  },

  putImage: function putImage(image, file) {
    expect(image.url).toBeDefined();
    expect(file.name).toBeDefined();
    expect(file.contentType).toBeDefined();
    const { url } = image;
    return this.putFileToURL(url, file);
  },

  getImageURLs: async function getImageURLs(
    session,
    images,
    status = 200,
    error
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .post(`/images/url`)
      .set(headers)
      .send(images)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBe(images.length);
    return r.body;
  },

  getImageURL: async function getImageURL(
    session,
    image,
    status = 200,
    error = undefined
  ) {
    const urls = await this.getImageURLs(session, [image], status, error);
    if (!urls) {
      return undefined;
    }
    return urls[0];
  },

  getFile: async function getFile(url, status = 200) {
    const tmpFile = this.tmpFile();
    const stream = fs.createWriteStream(tmpFile.name);
    const req = this.agent();
    const r = req.get(url).on('response', response => {
      expect(response.status).toEqual(status);
    });
    await r.pipe(stream);
    return tmpFile;
  },

  postRequest: async function postRequest(type, data, status, error) {
    const req = this.request();
    const r = await req
      .post(`/${type}`)
      .set('Content-Type', 'application/json')
      .send(data)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    return r.body;
  },

  requestRegistration: async function requestRegistration(
    user,
    status = 202,
    error = undefined
  ) {
    const r = await this.postRequest('registrations', user, status, error);
    if (!error) {
      expect(r.expires).toBeGreaterThan(Date.now());
    }
    return r;
  },

  completeRegistrationRequest: async function completeRegistrationRequest(
    id,
    status = 201,
    error = undefined
  ) {
    const req = this.request();
    const r = await req
      .post(`/registrations/${id}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.firstName).toBeDefined();
    expect(r.body.lastName).toBeDefined();
    expect(r.body.email).toBeDefined();
    return r.body;
  },

  requestPasswordReset: async function requestPasswordReset(
    email,
    status = 202,
    error = undefined
  ) {
    const r = await this.postRequest(
      'password_resets',
      { email },
      status,
      error
    );

    if (!error) {
      expect(r.expires).toBeGreaterThan(Date.now());
    }

    return r;
  },

  completePasswordResetRequest: async function completePasswordResetRequest(
    id,
    password,
    status = 200,
    error = undefined
  ) {
    const req = this.request();
    const r = await req
      .post(`/password_resets/${id}`)
      .set('Accept', 'application/json')
      .send({ password })
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.firstName).toBeDefined();
    expect(r.body.lastName).toBeDefined();
    expect(r.body.email).toBeDefined();
    return r.body;
  },

  completeInvite: async function completeInvite(
    id,
    user,
    status = 200,
    error = undefined
  ) {
    const req = this.request();
    const r = await req
      .post(`/invites/${id}`)
      .set('Accept', 'application/json')
      .send(user)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.firstName).toBeDefined();
    expect(r.body.lastName).toBeDefined();
    expect(r.body.email).toBeDefined();
    return r.body;
  },

  rejectInviteRequest: async function rejectInviteRequest(
    id,
    status = 204,
    error = undefined
  ) {
    const req = this.request();
    const r = await req
      .delete(`/invites/${id}`)
      .set('Accept', 'application/json')
      .expect(status);

    if (error) {
      expect(r.header['content-type']).toMatch(/json/);
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toEqual({});
    return r.body;
  },

  completeEmailChangeRequest: async function completeEmailChangeRequest(
    id,
    status = 200,
    error = undefined
  ) {
    const req = this.request();
    const r = await req
      .post(`/email_changes/${id}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.firstName).toBeDefined();
    expect(r.body.lastName).toBeDefined();
    expect(r.body.email).toBeDefined();
    return r.body;
  },

  checkAvailability: async function checkAvailability(
    variables,
    status = 200,
    error = undefined
  ) {
    const req = this.request();
    const r = await req
      .get('/registrations/available')
      .query(variables)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    return r.body;
  },

  login: async function login(
    { email, password },
    status = 201,
    error = undefined
  ) {
    const req = this.request();
    const r = await req
      .post('/me/login')
      .set('Content-Type', 'application/json')
      .send({ email, password })
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.token).toBeDefined();
    expect(r.body.expires).toBeGreaterThan(Date.now());
    return r.body;
  },

  renewSession: async function renewSession(
    session,
    status = 200,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .post('/me/renew')
      .set(headers)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.token).toBeDefined();
    expect(r.body.expires).toBeGreaterThan(Date.now());
    return r.body;
  },

  logout: async function logout(session, status = 204, error = undefined) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .post('/me/logout')
      .set(headers)
      .expect(status);

    if (error) {
      expect(r.header['content-type']).toMatch(/json/);
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toEqual({});
    return r.body;
  },

  getUserData: async function getUserData(
    session,
    status = 200,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .get('/me')
      .set(headers)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.firstName).toBeDefined();
    expect(r.body.lastName).toBeDefined();
    expect(r.body.email).toBeDefined();
    expect(r.body.language).toBeDefined();
    return r.body;
  },

  deleteAccount: async function deleteAccount(
    session,
    { password },
    status = 204,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .delete('/me')
      .set(headers)
      .send({ password })
      .expect(status);

    if (error) {
      expect(r.header['content-type']).toMatch(/json/);
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toEqual({});
    return r.body;
  },

  requestEmailChange: async function requestEmailChange(
    session,
    { password, newEmail },
    status = 202,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .put('/me/email')
      .set(headers)
      .send({ password, newEmail })
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.expires).toBeGreaterThan(Date.now());
    return r.body;
  },

  changePassword: async function changePassword(
    session,
    { password, newPassword },
    status = 204,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .put('/me/password')
      .set(headers)
      .send({ password, newPassword })
      .expect(status);

    if (error) {
      expect(r.header['content-type']).toMatch(/json/);
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toEqual({});
    return r.body;
  },

  changeLanguage: async function changeLanguage(
    session,
    language,
    status = 204,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .put('/me/language')
      .set(headers)
      .send({ language })
      .expect(status);

    if (error) {
      expect(r.header['content-type']).toMatch(/json/);
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toEqual({});
    return r.body;
  },

  changeAvatar: async function changeAvatar(
    session,
    image,
    status = 200,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .put('/me/avatar')
      .set(headers)
      .send({ image: image.id })
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.avatar).toBeDefined();
    return r.body;
  },

  invite: async function invite(
    session,
    email,
    status = 202,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .post('/users/invite')
      .set(headers)
      .send({ email })
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.id).toBeDefined();
    return r.body;
  },

  createImage: async function createImage(
    session,
    status = 201,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .post('/images')
      .set(headers)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.id).toBeDefined();
    expect(r.body.url).toBeDefined();
    return r.body;
  },

  uploadImage: async function uploadImage(session, imageFile) {
    const image = await this.createImage(session);
    await this.putImage(image, imageFile);
    return image;
  },

  compareImageToFile: async function compareImageToFile(image, imageFile) {
    const tmpFile = await this.getFile(image);
    expect(this.compareFiles(imageFile, tmpFile)).toBeTruthy();
    tmpFile.removeCallback();
  },

  deleteImage: async function deleteImage(
    session,
    { id },
    status = 204,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .delete(`/images/${id}`)
      .set(headers)
      .expect(status);

    if (error) {
      expect(r.header['content-type']).toMatch(/json/);
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toEqual({});
    return r.body;
  },

  batchUsers: async function batchUsers(
    session,
    ids,
    status = 200,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .post('/users/batch')
      .set(headers)
      .send(ids)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toBeDefined();
    expect(Array.isArray(r.body)).toBe(true);
    r.body.forEach(u => {
      expect(u.id).toBeDefined();
      expect(u.id).toHaveLength(UID_LENGTH);
      expect(u.firstName).toBeDefined();
      expect(u.lastName).toBeDefined();
      expect(u.email).toBeDefined();
      expect(u.avatar).toBeDefined();
    });
    return r.body;
  },

  findUsers: async function findUsers(
    session,
    email,
    status = 200,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .get(`/users`)
      .set(headers)
      .query({ email })
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(Array.isArray(r.body)).toEqual(true);
    for (let i = 0; i < r.body.length; i += 1) {
      expect(r.body[i].id).toHaveLength(UID_LENGTH);
      expect(r.body[i].firstName).toBeDefined();
      expect(r.body[i].lastName).toBeDefined();
      expect(r.body[i].email).toBeDefined();
      expect(r.body[i].avatar).toBeDefined();
    }
    return r.body;
  },

  findUser: async function findUser(
    session,
    email,
    status = 200,
    error = undefined
  ) {
    const users = await this.findUsers(session, email, status, error);

    if (users) {
      expect(users).toHaveLength(1);
      return users[0];
    }
    return undefined;
  },

  getFriends: async function getFriends(
    session,
    params,
    status = 200,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .get('/users/friends')
      .set(headers)
      .query(params)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(Array.isArray(r.body)).toBe(true);
    r.body.forEach(u => {
      expect(parseInt(u.index, 10)).toBeGreaterThan(0);
      expect(u.id).toHaveLength(UID_LENGTH);
      expect(u.firstName).toBeDefined();
      expect(u.lastName).toBeDefined();
      expect(u.email).toBeDefined();
      expect(u.avatar).toBeDefined();
    });
    return r.body;
  },

  getBlocked: async function getBlocked(
    session,
    params = {},
    status = 200,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .get('/users/blocked')
      .set(headers)
      .query(params)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(Array.isArray(r.body)).toBe(true);
    r.body.forEach(p => {
      expect(p.id).toBeDefined();
      expect(p.firstName).toBeDefined();
      expect(p.lastName).toBeDefined();
      expect(p.email).toBeDefined();
      expect(p.avatar).toBeDefined();
    });
    return r.body;
  },

  putBlocked: async function putBlocked(session, id, blocked, status, error) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .put(`/users/${id}/blocked`)
      .set(headers)
      .send({ blocked })
      .expect(status);

    if (error) {
      expect(r.header['content-type']).toMatch(/json/);
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toEqual({});
    return r.body;
  },

  block: function block(session, { id }, status = 204, error = undefined) {
    return this.putBlocked(session, id, true, status, error);
  },

  unblock: function unblock(session, { id }, status = 204, error = undefined) {
    return this.putBlocked(session, id, false, status, error);
  },

  unfriend: async function unfriend(
    session,
    { id },
    status = 204,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .put(`/users/${id}/unfriend`)
      .set(headers)
      .expect(status);

    if (error) {
      expect(r.header['content-type']).toMatch(/json/);
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toEqual({});
    return r.body;
  },

  createPostcard: async function createPostcard(
    session,
    postcard,
    status = 201,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .post('/postcards')
      .set(headers)
      .send(postcard)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.id).toBeDefined();
    return r.body;
  },

  sendRandomPostcard: async function sendRandomPostcard(
    session,
    receiver,
    image
  ) {
    const postcard = this.randomPostcard(receiver, image);
    const p = await this.createPostcard(session, postcard);
    postcard.id = p.id;
    return postcard;
  },

  batchPostcards: async function batchPostcards(
    session,
    ids,
    status = 200,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .post('/postcards/batch')
      .set(headers)
      .send(ids)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toBeDefined();
    expect(Array.isArray(r.body)).toBe(true);
    r.body.forEach(p => {
      expect(p.id).toBeDefined();
      expect(p.id).toHaveLength(UID_LENGTH);
      expect(p.sender).toBeDefined();
      expect(p.sender).toHaveLength(UID_LENGTH);
      expect(p.receiver).toBeDefined();
      expect(p.receiver).toHaveLength(UID_LENGTH);
      expect(p.image).toBeDefined();
      expect(p.message).toBeDefined();
      expect(p.location).toBeDefined();
      expect(p.created).toBeDefined();
      expect(p.read).toBeDefined();
    });
    return r.body;
  },

  batchReadStatuses: async function batchReadStatuses(
    session,
    ids,
    status = 200,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .post('/postcards/batch-read')
      .set(headers)
      .send(ids)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toBeDefined();
    expect(Array.isArray(r.body)).toBe(true);
    r.body.forEach(p => {
      expect(p.id).toBeDefined();
      expect(p.id).toHaveLength(UID_LENGTH);
      expect(p.read).toBeDefined();
    });
    return r.body;
  },

  getInbox: async function getInbox(
    session,
    params,
    status = 200,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .get('/postcards/inbox')
      .set(headers)
      .query(params)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(Array.isArray(r.body)).toBe(true);
    r.body.forEach(p => {
      expect(parseInt(p.index, 10)).toBeGreaterThan(0);
      // expect(p.user).toHaveLength(UID_LENGTH);
      expect(p.postcard).toHaveLength(UID_LENGTH);
      // expect(parseInt(p.index, 10)).toBeGreaterThan(0);
      // expect(p.sender).toHaveLength(UID_LENGTH);
      // expect(p.image).toBeDefined();
      // expect(p.message).toBeDefined();
      // expect(p.location).toBeDefined();
      // expect(p.created).toBeDefined();
      // expect(p.read).toBeDefined();
    });
    return r.body;
  },

  getInboxPostcards: async function getInboxPostcards(session) {
    const inbox = await this.getInbox(session);
    return this.batchPostcards(session, inbox.map(i => i.postcard));
  },

  removeFromInbox: async function removeFromInbox(
    session,
    { index },
    status = 204,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .delete(`/postcards/inbox/${index}`)
      .set(headers)
      .expect(status);

    if (error) {
      expect(r.header['content-type']).toMatch(/json/);
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toEqual({});
    return r.body;
  },

  setAsRead: async function setAsRead(
    session,
    { id },
    status = 204,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .put(`/postcards/${id}/read`)
      .set(headers)
      .expect(status);

    if (error) {
      expect(r.header['content-type']).toMatch(/json/);
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toEqual({});
    return r.body;
  },

  connectToSender: async function connectToSender(
    session,
    { id },
    status = 204,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .post(`/postcards/${id}/connect`)
      .set(headers)
      .expect(status);

    if (error) {
      expect(r.header['content-type']).toMatch(/json/);
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toEqual({});
    return r.body;
  },

  // blockSender: async function blockSender(
  //   session,
  //   { index },
  //   status = 204,
  //   error = undefined
  // ) {
  //   const headers = this.sessionHeaders(session);
  //   const req = this.request();
  //   const r = await req
  //     .post(`/postcards/inbox/${index}/block`)
  //     .set(headers)
  //     .expect(status);

  //   if (error) {
  //     expect(r.header['content-type']).toMatch(/json/);
  //     expect(r.body).toEqual(error);
  //     return undefined;
  //   }

  //   expect(r.body).toEqual({});
  //   return r.body;
  // },

  getSent: async function getSent(
    session,
    params,
    status = 200,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .get('/postcards/sent')
      .set(headers)
      .query(params)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(Array.isArray(r.body)).toBe(true);
    r.body.forEach(p => {
      expect(parseInt(p.index, 10)).toBeGreaterThan(0);
      expect(p.postcard).toHaveLength(UID_LENGTH);
      // expect(parseInt(p.index, 10)).toBeGreaterThan(0);
      // expect(p.receiver).toHaveLength(UID_LENGTH);
      // expect(p.image).toBeDefined();
      // expect(p.message).toBeDefined();
      // expect(p.location).toBeDefined();
      // expect(p.created).toBeDefined();
      // expect(p.read).toBeDefined();
    });
    return r.body;
  },

  getSentPostcards: async function getSentPostcards(session) {
    const sent = await this.getSent(session);
    return this.batchPostcards(session, sent.map(s => s.postcard));
  },

  removeFromSent: async function removeFromSent(
    session,
    { index },
    status = 204,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .delete(`/postcards/sent/${index}`)
      .set(headers)
      .expect(status);

    if (error) {
      expect(r.header['content-type']).toMatch(/json/);
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body).toEqual({});
    return r.body;
  },

  createEndpoint: async function createEndpoint(
    session,
    status = 201,
    error = undefined
  ) {
    const headers = this.sessionHeaders(session);
    const req = this.request();
    const r = await req
      .post('/me/endpoint')
      .set(headers)
      .expect('Content-Type', /json/)
      .expect(status);

    if (error) {
      expect(r.body).toEqual(error);
      return undefined;
    }

    expect(r.body.id).toBeDefined();
    expect(r.body.expires).toBeDefined();
    return r.body;
  },

  createEndpoints: function createEndpoints(sessions) {
    return Promise.all(sessions.map(s => this.createEndpoint(s)));
  },

  connectToEndpoints: function connectToEndpoints(endpoints) {
    return Promise.all(
      endpoints.map(endpoint => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(this.endpointAddress(endpoint.id));
          ws.on('open', () => {
            resolve(ws);
          });
          ws.on('error', event => {
            reject(event);
          });
        });
      })
    );
  },

  connectToInvalidEndpoint: function connectToInvalidEndpoint(endpoint) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.endpointAddress(endpoint.id));
      ws.on('open', () => {
        ws.close();
        reject(new Error('Unexpected: connection succeeded'));
      });
      ws.on('unexpected-response', () => {
        try {
          ws.terminate();
        } catch (e) {
          /* */
        }
        resolve();
      });
    });
  },

  // subscribeToEvents: function subscribeToEvents(ws, { token }) {
  //   return new Promise((resolve, reject) => {
  //     ws.send(JSON.stringify({ token }));
  //     function listener(data) {
  //       const m = JSON.parse(data);
  //       if (m.type === 'subscribed' && m.token === token) {
  //         ws.removeEventListener('message', listener);
  //         resolve(ws);
  //       } else {
  //         reject(new Error('Unexpected reply'));
  //       }
  //     }
  //     ws.on('message', listener);
  //   });
  // },

  bufferMessages: function bufferMessages(wses) {
    return wses.map(ws => {
      const buffer = new MessageBuffer();
      ws.on('message', message => {
        buffer.push(this.parseJSON(message));
      });
      return buffer;
    });
  },

  bufferClose: function bufferClose(ws) {
    const buffer = new MessageBuffer();
    ws.on('close', message => {
      buffer.push(JSON.parse(message));
    });
    return buffer;
  },

  waitForBuffer: function waitForBuffer(
    buffer,
    numberOfMessages = 1,
    timeout = 1000
  ) {
    if (buffer.messages().length >= numberOfMessages) {
      return buffer.messages();
    }
    return new Promise((resolve, reject) => {
      let done = false;
      let timer;
      function onMessage() {
        if (!done) {
          const b = buffer.messages();
          if (b.length >= numberOfMessages) {
            done = true;
            buffer.unsubscribe(onMessage);
            clearTimeout(timer);
            resolve(b);
          }
        }
      }
      timer = setTimeout(() => {
        if (!done) {
          done = true;
          buffer.unsubscribe(onMessage);
          reject(new Error('Timeout'));
        }
      }, timeout);
      buffer.subscribe(onMessage);
    });
  },

  waitForPong: function waitForPong(wsses, timeout = 1000) {
    return Promise.all(
      wsses.map(wss => {
        return new Promise((resolve, reject) => {
          let done = false;
          let timer;
          function onPong() {
            if (!done) {
              done = true;
              wss.removeEventListener('pong', onPong);
              clearTimeout(timer);
              resolve();
            }
          }
          timer = setTimeout(() => {
            if (!done) {
              done = true;
              wss.removeEventListener('pong', onPong);
              reject(new Error('Timeout'));
            }
          }, timeout);
          wss.on('pong', onPong);
          wss.ping('ping');
        });
      })
    );
  },

  /* ---------------------------------------------------------------- */

  devCreateUser: async function devCreateUser() {
    const req = this.request();
    const user = this.randomUser();
    const r = await req
      .post('/dev/users')
      .set('Content-Type', 'application/json')
      .send(user)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(201);

    expect(r.body.id).toBeDefined();
    expect(r.body.firstName).toEqual(user.firstName);
    expect(r.body.lastName).toEqual(user.lastName);
    expect(r.body.email).toEqual(user.email);
    expect(r.body.language).toEqual(user.language);
    return { ...r.body, password: user.password };
  },

  devFindUser: async function devFindUser(email) {
    const req = this.request();
    const r = await req
      .get(`/dev/users`)
      .query({ email })
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(Array.isArray(r.body)).toBe(true);
    if (r.body[0]) {
      const u = r.body[0];
      expect(u.id).toBeDefined();
      expect(u.email).toBeDefined();
      expect(u.passhash).toBeDefined();
      expect(u.firstName).toBeDefined();
      expect(u.lastName).toBeDefined();
      expect(u.language).toBeDefined();
      expect(u.avatar).toBeDefined();
    }
    return r.body[0] || undefined;
  },

  devGetUsers: async function devGetUsers(status = 200) {
    const req = this.request();
    const r = await req
      .get(`/dev/users`)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(status);

    if (status !== 200) {
      return undefined;
    }

    expect(Array.isArray(r.body)).toBe(true);
    r.body.forEach(u => {
      expect(u.id).toBeDefined();
      expect(u.email).toBeDefined();
      expect(u.passhash).toBeDefined();
      expect(u.firstName).toBeDefined();
      expect(u.lastName).toBeDefined();
      expect(u.language).toBeDefined();
      expect(u.avatar).toBeDefined();
    });
    return r.body;
  },

  devDeleteUser: async function devDeleteUser({ id }) {
    const req = this.request();
    const r = await req.delete(`/dev/users/${id}`).expect(204);
    expect(r.body).toEqual({});
  },

  devClearUsers: async function devClearUsers() {
    const req = this.request();
    await req.post(`/dev/users/clear`).expect(204);
  },

  devMakeFriends: async function devMakeFriends(user, friend) {
    const req = this.request();
    const r = await req
      .post('/dev/users/friends')
      .set('Content-Type', 'application/json')
      .send({ user: user.id, friend: friend.id })
      .set('Accept', 'application/json')
      .expect(201);

    const c = r.body;
    expect(c).toHaveLength(2);
    expect(parseInt(c[0].index, 10)).toBeGreaterThan(0);
    expect(c[0].user).toEqual(user.id);
    expect(c[0].friend).toEqual(friend.id);
    expect(parseInt(c[1].index, 10)).toBeGreaterThan(0);
    expect(c[1].user).toEqual(friend.id);
    expect(c[1].friend).toEqual(user.id);
    return r.body;
  },

  devClearFriends: async function devClearFriends() {
    const req = this.request();
    await req.post(`/dev/users/friends/clear`).expect(204);
  },

  devClearBlocked: async function devClearBlocked() {
    const req = this.request();
    await req.post(`/dev/users/blocked/clear`).expect(204);
  },

  devGetRequests: async function devGetRequests(type) {
    const req = this.request();
    const r = await req
      .get(`/dev/${type}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(r.body).toBeDefined();
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThanOrEqual(0);
    return r.body;
  },

  devGetSessions: async function devGetSessions() {
    return this.devGetRequests('sessions');
  },

  devClearSessions: async function devClearSessions() {
    const req = this.request();
    await req.post(`/dev/sessions/clear`).expect(204);
  },

  devGetRegistrationRequests: function devGetRegistrationRequests() {
    return this.devGetRequests('registrations');
  },

  devGetPasswordResetRequests: function devGetPasswordResetRequests() {
    return this.devGetRequests('password_resets');
  },

  devGetEmailChangeRequests: function devGetEmailChangeRequests() {
    return this.devGetRequests('email_changes');
  },

  devGetEndpointRequests: function devGetEndpointRequests() {
    return this.devGetRequests('endpoints');
  },

  devClearRequests: async function devClearRequests() {
    const req = this.request();
    await req.post(`/dev/requests/clear`).expect(204);
  },

  devGetInvites: function devGetInvites() {
    return this.devGetRequests('invites');
  },

  devClearInvites: async function devClearInvites() {
    const req = this.request();
    await req.post(`/dev/invites/clear`).expect(204);
  },

  devIgnore: async function devIgnore(email) {
    const req = this.request();
    await req
      .post('/dev/ignored')
      .set('Content-Type', 'application/json')
      .send({ email })
      .set('Accept', 'application/json')
      .expect(204);
  },

  devGetIgnored: async function devGetIgnored() {
    const req = this.request();
    const r = await req
      .get(`/dev/ignored`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(r.body).toBeDefined();
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThanOrEqual(0);
    return r.body;
  },

  devClearIgnored: async function devClearIgnored() {
    const req = this.request();
    await req
      .post('/dev/ignored/clear')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect(204);
  },

  devGetUploads: function devGetUploads() {
    return this.devGetImages('uploads');
  },

  devClearUploads: async function devClearUploads() {
    const req = this.request();
    await req.post(`/dev/uploads/clear`).expect(204);
  },

  devGetImages: async function devGetImages(type = 'images') {
    const req = this.request();
    const r = await req
      .get(`/dev/${type}`)
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThanOrEqual(0);
    return r.body;
  },

  devClearImages: async function devClearImages() {
    const req = this.request();
    await req.post(`/dev/images/clear`).expect(204);
  },

  devGetPostcards: async function devGetPostcards() {
    const req = this.request();
    const r = await req
      .get(`/dev/postcards`)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(Array.isArray(r.body)).toBe(true);
    r.body.forEach(u => {
      expect(u.id).toBeDefined();
      expect(u.sender).toBeDefined();
      expect(u.receiver).toBeDefined();
      expect(u.image).toBeDefined();
      expect(u.message).toBeDefined();
      expect(u.location).toBeDefined();
      expect(u.created).toBeDefined();
    });
    return r.body;
  },

  devDeletePostcard: async function devDeletePostcard({ id }) {
    const req = this.request();
    const r = await req.delete(`/dev/postcards/${id}`).expect(204);
    expect(r.body).toEqual({});
  },

  devClearPostcards: async function devClearPostcards() {
    const req = this.request();
    await req.post(`/dev/postcards/clear`).expect(204);
  },

  devRESET: async function devRESET() {
    const req = this.request();
    await req.post(`/dev/RESET`).expect(204);
  },
};
