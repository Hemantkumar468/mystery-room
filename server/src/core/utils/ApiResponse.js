/**
 * Single success-response contract for the whole API.
 * Shape: { success, message, data, meta }
 */
export class ApiResponse {
  constructor(data = null, message = 'OK', meta = undefined) {
    this.success = true;
    this.message = message;
    this.data = data;
    if (meta) this.meta = meta;
  }

  /** Send a 2xx JSON response. */
  static send(res, { statusCode = 200, data = null, message = 'OK', meta } = {}) {
    return res.status(statusCode).json(new ApiResponse(data, message, meta));
  }

  static ok(res, data, message = 'OK', meta) {
    return ApiResponse.send(res, { statusCode: 200, data, message, meta });
  }

  static created(res, data, message = 'Created') {
    return ApiResponse.send(res, { statusCode: 201, data, message });
  }

  static noContent(res) {
    return res.status(204).send();
  }
}

export default ApiResponse;
