import { expect, it } from "vitest";
import { isAllowedR2Url } from "./upload-url";

it("accepts our HTTPS upload URLs and rejects arbitrary hosts and protocols", () => {
  expect(isAllowedR2Url("https://files.localcooks.ca/storage-handover/photo.jpg")).toBe(true);
  for (const url of ["https://example.com/photo.jpg", "https://files.localcooks.ca.example.com/photo.jpg", "http://files.localcooks.ca/photo.jpg", "ftp://files.localcooks.ca/photo.jpg", "not a URL"])
    expect(isAllowedR2Url(url)).toBe(false);
});
