/*
 *
 */
/* eslint-disable global-require */
jest.mock('minio');

jest.mock('../utils');
jest.mock('../config');
jest.mock('../logger');

let minio;
let client;

let config;
let logger;
let utils;

let filestore;

describe('filestore.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();

    minio = require('minio');
    client = new minio.Client();

    config = require('../config');
    config.minio = {
      accessKeyId: 'accessKeyId',
      secretAccessKey: 'secretAccessKey',
      useSSL: 'useSSL',
      region: 'region',
      endpoint: 'endpoint',
      port: 'port',
    };
    config.filestore = {
      uploadBucket: 'uploadBucket',
      imageBucket: 'imageBucket',
      devPublicHost: undefined,
    };
    logger = require('../logger');
    utils = require('../utils');

    process.env.NODE_ENV = 'production';
    filestore = require('../filestore');
  });

  describe('helper functions', () => {
    test('isValidFileId should work', async () => {
      utils.isValidId.mockReturnValue(true);

      const fileId = 'file-1';
      expect(filestore.isValidFileId(fileId)).toBe(true);
      expect(utils.isValidId).toBeCalledTimes(1);
      expect(utils.isValidId).toHaveBeenNthCalledWith(1, fileId);
    });
  });

  describe('initialize and shutdown', () => {
    test('initialize and shutdown should work', async () => {
      filestore.initialize();
      filestore.initialize();

      filestore.shutdown();
    });

    test('initialize should throw on unexpected error', async () => {
      minio.Client.mockImplementation(() => {
        throw new Error('TEST');
      });
      expect(filestore.initialize).toThrow('TEST');
    });
  });

  describe('putUploadURL', () => {
    test('putUploadURL should work', async () => {
      const id = 'id';
      utils.createId.mockReturnValue(id);

      const url = 'url';
      client.presignedPutObject.mockResolvedValue(url);

      filestore.initialize();
      const r = await filestore.putUploadURL();
      expect(r).toEqual({ id, url });
    });

    test('putUploadURL should throw on filestore failure', async () => {
      const id = 'id';
      utils.createId.mockReturnValue(id);

      client.presignedPutObject.mockRejectedValue(new Error('TEST'));

      filestore.initialize();
      await expect(filestore.putUploadURL()).rejects.toThrow('TEST');
    });
  });

  describe('copyUploadToImages', () => {
    test('copyUploadToImages should work', async () => {
      utils.isValidId.mockReturnValue(true);

      const id = 'id';
      utils.createId.mockReturnValue(id);

      client.copyObject.mockResolvedValue(true);

      filestore.initialize();
      const upload = 'upload';
      const r = await filestore.copyUploadToImages(upload);
      expect(r).toEqual(id);
    });

    test('copyUploadToImages should reject invalid id', async () => {
      utils.isValidId.mockReturnValue(false);

      filestore.initialize();
      const upload = 'upload';
      expect(await filestore.copyUploadToImages(upload)).not.toBeDefined();
      expect(utils.createId).not.toBeCalled();
      expect(client.copyObject).not.toBeCalled();
    });

    test('copyUploadToImages should return undefined on filestore failure', async () => {
      utils.isValidId.mockReturnValue(true);

      const id = 'id';
      utils.createId.mockReturnValue(id);

      client.copyObject.mockRejectedValue(new Error('TEST'));

      filestore.initialize();
      const upload = 'upload';
      expect(await filestore.copyUploadToImages(upload)).not.toBeDefined();
      expect(client.copyObject).toBeCalledTimes(1);
    });
  });

  // describe('hasImage', () => {
  //   test('hasImage should work', async () => {
  //     filestore.initialize();
  //     utils.isValidId.mockReturnValue(true);

  //     const image = 'image';
  //     client.statObject.mockResolvedValue(true);
  //     expect(await filestore.hasImage(image)).toBe(true);

  //     client.statObject.mockRejectedValue(new Error('TEST'));
  //     expect(await filestore.hasImage(image)).toBe(false);
  //   });

  //   test('hasImage should reject invalid image', async () => {
  //     filestore.initialize();
  //     utils.isValidId.mockReturnValue(false);

  //     const image = 'image';
  //     expect(await filestore.hasImage(image)).toBe(false);
  //     expect(client.statObject).not.toBeCalled();

  //     expect(await filestore.hasImage(undefined)).toBe(false);
  //     expect(client.statObject).not.toBeCalled();
  //   });
  // });

  describe('getImageURLs', () => {
    test('getImageURLs should work', async () => {
      filestore.initialize();
      // utils.isValidId.mockReturnValue(true);

      const url = 'url';
      client.presignedGetObject.mockResolvedValue(url);

      const images = ['image'];
      const [r] = await filestore.getImageURLs(images);
      expect(r).toEqual(url);
      expect(client.presignedGetObject).toBeCalledTimes(1);
    });

    test('getImageURLs should work with empty image list', async () => {
      filestore.initialize();
      // utils.isValidId.mockReturnValue(true);

      const images = [];
      const [r] = await filestore.getImageURLs(images);
      expect(r).not.toBeDefined();
      expect(client.presignedGetObject).not.toBeCalled();
    });

    // test('getImageURLs should skip invalid images', async () => {
    //   filestore.initialize();
    //   utils.isValidId.mockReturnValue(false);

    //   const images = ['image-1', 'image-2'];
    //   const [a, b] = await filestore.getImageURLs(images);
    //   expect(a).not.toBeDefined();
    //   expect(b).not.toBeDefined();
    //   expect(client.presignedGetObject).not.toBeCalled();
    // });

    test('getImageURLs should throw on filestore failure', async () => {
      filestore.initialize();
      // utils.isValidId.mockReturnValue(true);

      client.presignedGetObject.mockRejectedValue(new Error('TEST'));

      const images = ['image'];
      await expect(filestore.getImageURLs(images)).rejects.toThrow('TEST');
      expect(client.presignedGetObject).toBeCalledTimes(1);
    });
  });

  describe('deleteUpload', () => {
    test('deleteUpload should work', async () => {
      filestore.initialize();
      utils.isValidId.mockReturnValue(true);

      const image = 'image';
      client.removeObject.mockResolvedValue(true);
      await filestore.deleteUpload(image);
      expect(client.removeObject).toBeCalledTimes(1);
    });

    test('deleteUpload should reject invalid image', async () => {
      filestore.initialize();
      utils.isValidId.mockReturnValue(false);

      const image = 'image';
      await filestore.deleteUpload(image);
      expect(client.removeObject).not.toBeCalled();
    });

    test('deleteUpload should throw on filestore failure', async () => {
      filestore.initialize();
      utils.isValidId.mockReturnValue(true);

      client.removeObject.mockRejectedValue(new Error('TEST'));

      const images = ['image'];
      await expect(filestore.deleteUpload(images)).rejects.toThrow('TEST');
      expect(client.removeObject).toBeCalledTimes(1);
    });
  });

  describe('deleteImage', () => {
    test('deleteImage should work', async () => {
      filestore.initialize();
      // utils.isValidId.mockReturnValue(true);

      const image = 'image';
      client.removeObject.mockResolvedValue(true);
      await filestore.deleteImage(image);
      expect(client.removeObject).toBeCalledTimes(1);
    });

    // test('deleteImage should reject invalid image', async () => {
    //   filestore.initialize();
    //   utils.isValidId.mockReturnValue(false);

    //   const image = 'image';
    //   await filestore.deleteImage(image);
    //   expect(client.removeObject).not.toBeCalled();
    // });

    test('deleteImage should throw on filestore failure', async () => {
      filestore.initialize();
      // utils.isValidId.mockReturnValue(true);
      client.removeObject.mockRejectedValue(new Error('TEST'));

      const images = ['image'];
      await expect(filestore.deleteImage(images)).rejects.toThrow('TEST');
      expect(client.removeObject).toBeCalledTimes(1);
    });
  });
});

describe('filestore.js development', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();

    minio = require('minio');
    client = new minio.Client();

    config = require('../config');
    config.minio = {
      accessKeyId: 'accessKeyId',
      secretAccessKey: 'secretAccessKey',
      useSSL: 'useSSL',
      region: 'region',
      endpoint: 'endpoint',
      port: 'port',
    };
    config.filestore = {
      uploadBucket: 'uploadBucket',
      imageBucket: 'imageBucket',
      devPublicHost: 'devPublicHost',
    };
    logger = require('../logger');
    utils = require('../utils');
  });
  test('development code should be included in non-production', async () => {
    process.env.NODE_ENV = 'development';
    filestore = require('../filestore');

    const stream = {
      on: jest.fn(),
    };
    client.listObjects.mockReturnValue(stream);

    filestore.initialize();
    let p = filestore.devGetUploads();

    stream.on.mock.calls[0][1]({ name: 'UPLOAD-0' });
    stream.on.mock.calls[0][1]({ name: 'UPLOAD-1' });
    stream.on.mock.calls[2][1]();

    const uploads = await p;
    expect(uploads).toEqual(['UPLOAD-0', 'UPLOAD-1']);

    p = filestore.devGetUploads();
    stream.on.mock.calls[1][1](new Error('TEST'));
    expect(p).rejects.toThrow('TEST');

    stream.on.mockClear();
    p = filestore.devGetImages();
    stream.on.mock.calls[0][1]({ name: 'IMAGE-0' });
    stream.on.mock.calls[2][1]();

    const images = await p;
    expect(images).toEqual(['IMAGE-0']);

    stream.on.mockClear();
    client.removeObjects.mockResolvedValue();
    p = filestore.devClearUploads();
    stream.on.mock.calls[0][1]({ name: 'file-0' });
    stream.on.mock.calls[2][1]();

    await p;

    stream.on.mockClear();
    client.removeObjects.mockResolvedValue();
    p = filestore.devClearImages();
    stream.on.mock.calls[0][1]({ name: 'file-0' });
    stream.on.mock.calls[2][1]();

    await p;

    utils.createId.mockReturnValue('id');
    client.presignedPutObject.mockResolvedValue(
      `${config.endpoint}:${config.port}`
    );
    await filestore.putUploadURL();

    utils.isValidId.mockReturnValue(true);
    client.presignedGetObject.mockResolvedValue(
      `${config.endpoint}:${config.port}`
    );
    await filestore.getImageURLs(['image-0', 'image-1']);
  });

  test('development code should not be included in production', async () => {
    process.env.NODE_ENV = 'production';
    filestore = require('../filestore');

    filestore.initialize();
    expect(filestore.devGetUploads).not.toBeDefined();
    expect(filestore.devGetImages).not.toBeDefined();
    expect(filestore.devClearUploads).not.toBeDefined();
    expect(filestore.devClearImages).not.toBeDefined();
  });
});
