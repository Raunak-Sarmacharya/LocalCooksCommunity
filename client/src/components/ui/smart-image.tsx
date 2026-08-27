import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";
import { cn } from "@/lib/utils";

export interface SmartImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  /** Hide the image (and its placeholder) if loading fails. */
  hideOnError?: boolean;
}

function splitClassName(className?: string) {
  const tokens = (className ?? "").split(/\s+/).filter(Boolean);
  const wrap: string[] = [];
  const img: string[] = [];

  for (const token of tokens) {
    if (
      token.includes("object-") ||
      token.includes("scale-") ||
      token.includes("transition-transform") ||
      token.includes("duration-") ||
      token.includes("transition-opacity") ||
      token.includes("opacity-") ||
      token.includes("select-none")
    ) {
      img.push(token);
    } else {
      wrap.push(token);
    }
  }

  return { wrap: wrap.join(" "), img: img.join(" ") };
}

function usesFillLayout(className?: string) {
  const c = className ?? "";
  if (/\baspect-/.test(c)) return true;
  if (/\bsize-/.test(c)) return true;
  if (/\binset-/.test(c)) return true;
  if (/\bh-full\b/.test(c)) return true;
  const hasFixedHeight = /\bh-(px|\d|\[)/.test(c);
  const hasFixedWidth = /\b(w-(px|\d|full|screen|\[)|size-)/.test(c);
  return hasFixedHeight && hasFixedWidth;
}

function isImageReady(image: HTMLImageElement | null) {
  return Boolean(image && image.complete && image.naturalWidth > 0);
}

export const SmartImage = forwardRef<HTMLImageElement, SmartImageProps>(
  function SmartImage(
    {
      alt,
      className,
      hideOnError = false,
      loading = "lazy",
      decoding = "async",
      onLoad,
      onError,
      src,
      style,
      ...props
    },
    forwardedRef
  ) {
    const innerRef = useRef<HTMLImageElement | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const fill = usesFillLayout(className);
    const { wrap, img } = splitClassName(className);

    const setRefs = useCallback(
      (node: HTMLImageElement | null) => {
        innerRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef]
    );

    useLayoutEffect(() => {
      setLoaded(false);
      setFailed(false);
      if (isImageReady(innerRef.current)) {
        setLoaded(true);
      }
    }, [src]);

    const handleLoad = async (event: SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      try {
        if (typeof image.decode === "function") {
          await image.decode();
        }
      } catch {
        // decode() rejects for broken images; onError handles that path.
      }
      setLoaded(true);
      onLoad?.(event);
    };

    const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
      setFailed(true);
      setLoaded(true);
      onError?.(event);
    };

    if (failed && hideOnError) {
      return null;
    }

    const showLoader = Boolean(src) && !loaded && !failed;

    const positioned = /\b(absolute|fixed|sticky)\b/.test(wrap);
    const inline = !fill && /\bw-auto\b/.test(className ?? "");

    return (
      <span
        className={cn(
          "overflow-hidden",
          !positioned && "relative",
          !positioned && (inline ? "inline-block" : "block"),
          wrap
        )}
        data-loaded={loaded ? "true" : "false"}
      >
        <img
          {...props}
          ref={setRefs}
          src={src}
          alt={alt ?? ""}
          loading={loading}
          decoding={decoding}
          onLoad={handleLoad}
          onError={handleError}
          style={fill ? { ...style, position: "absolute", inset: 0 } : style}
          className={cn(
            fill && "h-full w-full",
            !fill && "block max-h-full max-w-full",
            img || "object-cover",
            "transition-opacity duration-500 ease-out",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
        {showLoader && (
          <span className="image-shimmer pointer-events-none absolute inset-0" aria-hidden="true" />
        )}
      </span>
    );
  }
);

SmartImage.displayName = "SmartImage";
