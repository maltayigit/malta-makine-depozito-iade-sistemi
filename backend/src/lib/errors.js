class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(msg, details) {
    return new ApiError(400, msg, details);
  }
  static unauthorized(msg = 'Kimlik doğrulama gerekli.') {
    return new ApiError(401, msg);
  }
  static forbidden(msg = 'Bu işlem için yetkiniz yok.') {
    return new ApiError(403, msg);
  }
  static notFound(msg = 'Kayıt bulunamadı.') {
    return new ApiError(404, msg);
  }
  static conflict(msg = 'Kayıt çakışması.') {
    return new ApiError(409, msg);
  }
  static internal(msg = 'Sunucu hatası.') {
    return new ApiError(500, msg);
  }
}

module.exports = ApiError;
