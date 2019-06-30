/*
 *
 */
module.exports = {
  initialize: jest.fn(),
  shutdown: jest.fn(),
  deleteImage: jest.fn(),
  copyUploadToImages: jest.fn(),
  getImageURL: jest.fn(),
  getImageURLs: jest.fn(),
  putUploadURL: jest.fn(),
  deleteUpload: jest.fn(),
  isValidFileId: jest.fn(),
};
