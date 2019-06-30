/*
 *
 */
const minio = require('minio');

const utils = require('./utils');
const config = require('./config');
const logger = require('./logger');

const { isValidId, createId, definedKeys, changeHost } = utils;
const { uploadBucket, imageBucket, devPublicHost } = config.filestore;

let client;

function isValidFileId(id) {
  return isValidId(id);
}

function initialize() {
  logger.info('filestore.initialize');
  if (!client) {
    try {
      client = new minio.Client(definedKeys(config.minio));
    } catch (e) {
      logger.error(`filestore.initialize error: ${e}`);
      client = undefined;
      throw e;
    }
  }
}

function shutdown() {
  logger.info('database.shutdown');
  client = undefined;
}

async function getObjectURL(bucket, object) {
  const url = await client.presignedGetObject(bucket, object);
  if (process.env.NODE_ENV !== 'production' && devPublicHost) {
    return changeHost(url, devPublicHost);
  }
  return url;
}

async function putObjectURL(bucket, object) {
  const url = await client.presignedPutObject(bucket, object);
  if (process.env.NODE_ENV !== 'production' && devPublicHost) {
    return changeHost(url, devPublicHost);
  }
  return url;
}

function copyObject(bucket, object, source) {
  return client.copyObject(bucket, object, source);
}

function removeObject(bucket, object) {
  return client.removeObject(bucket, object);
}

// async function hasObject(bucket, object) {
//   try {
//     await client.statObject(bucket, object);
//     return true;
//   } catch (e) {
//     /* */
//   }
//   return false;
// }

/* ------------------------------------------------------------------ */

async function putUploadURL() {
  const id = createId();
  const url = await putObjectURL(uploadBucket, id);
  return { id, url };
}

async function copyUploadToImages(upload) {
  if (!isValidFileId(upload)) {
    return undefined;
  }
  try {
    const image = createId();
    await copyObject(imageBucket, image, `/${uploadBucket}/${upload}`);
    return image;
  } catch (e) {
    /* */
  }
  return undefined;
}

// function hasImage(image) {
//   return (isValidFileId(image) && hasObject(imageBucket, image)) || false;
// }

// function getImageURL(image) {
//   return (image && getObjectURL(imageBucket, image)) || undefined;
// }

function getImageURLs(images) {
  return Promise.all(images.map(i => getObjectURL(imageBucket, i)));
}

function deleteUpload(upload) {
  if (!isValidFileId(upload)) {
    return undefined;
  }
  return removeObject(uploadBucket, upload);
}

function deleteImage(image) {
  return removeObject(imageBucket, image);
}

module.exports = {
  isValidFileId,
  initialize,
  shutdown,
  putUploadURL,
  copyUploadToImages,
  // hasImage,
  // getImageURL,
  getImageURLs,
  deleteUpload,
  deleteImage,
};

/* ------------------------------------------------------------------ */
/* eslint-disable no-inner-declarations */
if (process.env.NODE_ENV !== 'production') {
  function devRemoveObjects(bucket, objects) {
    return client.removeObjects(bucket, objects);
  }

  function devListObjects(bucket) {
    const stream = client.listObjects(bucket, '', true);
    return new Promise((resolve, reject) => {
      const files = [];
      stream.on('data', obj => files.push(obj.name));
      stream.on('error', err => reject(err));
      stream.on('end', () => resolve(files));
    });
  }

  async function devClearBucket(bucket) {
    const objects = await devListObjects(bucket);
    return devRemoveObjects(bucket, objects);
  }

  function devGetUploads() {
    return devListObjects(uploadBucket);
  }

  function devGetImages() {
    return devListObjects(imageBucket);
  }

  function devClearUploads() {
    return devClearBucket(uploadBucket);
  }

  function devClearImages() {
    return devClearBucket(imageBucket);
  }

  module.exports = {
    ...module.exports,
    devGetUploads,
    devGetImages,
    devClearUploads,
    devClearImages,
  };
}
