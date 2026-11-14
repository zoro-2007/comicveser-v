const { getServerlessHandler } = require("../dist/main");

module.exports = async function handler(req, res) {
  const server = await getServerlessHandler();
  return server(req, res);
};
