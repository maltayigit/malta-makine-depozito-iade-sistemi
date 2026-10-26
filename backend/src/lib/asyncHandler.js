// Express, async route handler'lardaki reject'leri otomatik yakalamaz.
// Bu sarmalayıcı, hatayı next(err) ile merkezi error handler'a iletir.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
