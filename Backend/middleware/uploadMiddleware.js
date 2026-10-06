const multer = require('multer');

const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter(req, file, callback) {
    if (!acceptedImageTypes.has(file.mimetype)) {
      return callback(new Error('Upload JPEG, PNG, or WebP images only.'));
    }
    callback(null, true);
  }
});

async function validateImageFiles(files) {
  const { fileTypeFromBuffer } = await import('file-type');
  for (const file of files) {
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || detected.mime !== file.mimetype || !acceptedImageTypes.has(detected.mime)) return false;
  }
  return true;
}

module.exports = { upload, validateImageFiles };