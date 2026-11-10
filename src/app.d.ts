declare global {
  namespace App {
    interface Locals {
      /** The device this request comes from: from its API token, or the browser's own choice (a cookie), or a guess. */
      device: string;
      /** True when an API token proved it. */
      viaToken: boolean;
    }
  }
}

export {};
