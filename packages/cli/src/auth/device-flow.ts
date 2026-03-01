import * as p from "@clack/prompts";
import open from "open";

// GitHub OAuth App Client ID — users should register their own for production
// This is a placeholder; real usage requires a registered GitHub OAuth App
const CLIENT_ID = process.env.OPEN_AUTO_DOC_GITHUB_CLIENT_ID || "Ov23liroCfUzCH83wfsO";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface ErrorResponse {
  error: string;
  error_description?: string;
}

export async function authenticateWithGithub(): Promise<string> {
  // Step 1: Request device code
  const deviceResponse = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      scope: "repo read:user",
    }),
  });

  const deviceData = (await deviceResponse.json()) as DeviceCodeResponse;

  // Step 2: Show the user code and open browser
  p.note(
    `Code: ${deviceData.user_code}\n\nOpening ${deviceData.verification_uri} in your browser...`,
    "GitHub Authentication",
  );

  try {
    await open(deviceData.verification_uri);
  } catch {
    p.log.warn(`Could not open browser. Please visit: ${deviceData.verification_uri}`);
  }

  // Step 3: Poll for token
  const spinner = p.spinner();
  spinner.start("Waiting for GitHub authorization...");

  const token = await pollForToken(deviceData.device_code, deviceData.interval);

  spinner.stop("GitHub authentication successful!");
  return token;
}

async function pollForToken(deviceCode: string, interval: number): Promise<string> {
  const pollInterval = Math.max(interval, 5) * 1000;
  const maxAttempts = 60;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(pollInterval);

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = (await response.json()) as TokenResponse | ErrorResponse;

    if ("access_token" in data) {
      return data.access_token;
    }

    const error = data as ErrorResponse;
    if (error.error === "authorization_pending") {
      continue;
    } else if (error.error === "slow_down") {
      await sleep(5000);
      continue;
    } else if (error.error === "expired_token") {
      throw new Error("Authentication timed out. Please try again.");
    } else if (error.error === "access_denied") {
      throw new Error("Authentication was denied.");
    } else {
      throw new Error(`Authentication error: ${error.error_description || error.error}`);
    }
  }

  throw new Error("Authentication timed out after too many attempts.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
