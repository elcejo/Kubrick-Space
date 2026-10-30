// Translate plain operation results at the HTTP boundary; services never receive
// Express request/response objects. Rejected operations use the shared error path.
function endpoint(operation, portsFor = () => ({})) {
  return async (req, res, next) => {
    try {
      const result = await operation(
        { params: req.params, body: req.body, headers: req.headers, query: req.query },
        portsFor(req, res),
      );
      if (!result && res.headersSent) return;
      if (!result) throw new Error('La operación no devolvió un resultado.');
      for (const [name, value] of Object.entries(result.headers || {})) res.setHeader(name, value);
      if (result.status === 204) return res.sendStatus(204);
      res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  };
}
module.exports = { endpoint };
