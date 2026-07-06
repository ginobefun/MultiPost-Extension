export const BESTBLOGS_BASE_URL =
  process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://www.bestblogs.dev";

export const BESTBLOGS_SUBMIT_ENDPOINT = `${BESTBLOGS_BASE_URL}/api/extension/submit`;
export const BESTBLOGS_PUBLISH_URL = `${BESTBLOGS_BASE_URL}/dashboard/publish`;
export const BESTBLOGS_ON_INSTALL_URL = `${BESTBLOGS_BASE_URL}/extension`;

export const BESTBLOGS_TRUSTED_DOMAINS = ["bestblogs.dev", "www.bestblogs.dev", "*.bestblogs.dev"];

export const LOCAL_DEV_TRUSTED_DOMAINS = ["localhost", "127.0.0.1"];
