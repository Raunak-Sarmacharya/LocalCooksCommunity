import { getR2ProxyUrl } from "@/utils/r2-url-helper";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

/**
 * Turn a stored image reference into something an `<img>` can load.
 *
 * Kitchen images are stored in several shapes depending on when they were
 * uploaded — absolute R2 URLs, bucket hostnames without a protocol, bare
 * filenames, and local `/api/files/...` paths — and private R2 objects have to
 * go through the public proxy. Every place that renders one of these has to
 * apply the same rules, so they live here rather than inline.
 *
 * Returns `null` for an empty reference.
 */
export function resolveImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;

  // Already loadable.
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) return imageUrl;
  if (imageUrl.startsWith("/api/files/") || imageUrl.startsWith("/uploads/")) return imageUrl;

  // Bucket hostnames, with or without a protocol, are private → proxy them.
  const isR2Host =
    imageUrl.includes("files.localcooks.ca") ||
    imageUrl.includes("r2.cloudflarestorage.com");
  if (isR2Host) {
    return getR2ProxyUrl(imageUrl.startsWith("http") ? imageUrl : `https://${imageUrl}`);
  }

  // A bare filename means the object lives at the bucket root.
  //
  // Matched case-insensitively, which is a deliberate fix over the inline chain
  // this replaced: that compared against lowercase extensions only, so a stored
  // "photo.JPEG" fell through to the final branch and was returned as a bare
  // relative path — a broken image. Lowercase filenames were already being
  // proxied, so bare image filenames are R2 objects by definition here.
  const isPlainFilename =
    !imageUrl.startsWith("http://") &&
    !imageUrl.startsWith("https://") &&
    !imageUrl.startsWith("/") &&
    IMAGE_EXTENSIONS.some((extension) => imageUrl.toLowerCase().endsWith(extension));
  if (isPlainFilename) {
    return `/api/files/r2-proxy?filename=${encodeURIComponent(imageUrl)}`;
  }

  // Public dev domain (`.r2.dev`) and any other absolute URL are usable as-is.
  return imageUrl;
}
