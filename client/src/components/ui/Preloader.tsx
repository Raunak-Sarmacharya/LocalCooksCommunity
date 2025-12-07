import { useEffect, useState } from "react";
import Logo from "./logo";

interface PreloaderProps {
  onComplete?: () => void;
  duration?: number; // Duration in milliseconds
}

const foodItems = [
  { name: "cake", src: "https://www.localcooks.ca/food-cake.png" },
  { name: "noodles", src: "https://www.localcooks.ca/food-noodles.png" },
  { name: "wrap", src: "https://www.localcooks.ca/food-wrap.png" },
  { name: "biryani", src: "https://www.localcooks.ca/food-biryani.png" },
  { name: "shrimp", src: "https://www.localcooks.ca/food-shrimp.png" },
];

export default function Preloader({ onComplete, duration = 3000 }: PreloaderProps) {
  const [progress, setProgress] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    // Animate progress from 0 to 97%
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 97) {
          clearInterval(progressInterval);
          return 97;
        }
        return prev + 1;
      });
    }, duration / 97);

    // Rotate the orbit ring
    const rotationInterval = setInterval(() => {
      setRotation((prev) => (prev + 0.5) % 360);
    }, 16); // ~60fps

    // Hide preloader after duration
    const hideTimeout = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => {
        onComplete?.();
      }, 400); // Wait for fade-out animation
    }, duration);

    return () => {
      clearInterval(progressInterval);
      clearInterval(rotationInterval);
      clearTimeout(hideTimeout);
    };
  }, [duration, onComplete]);

  if (!isVisible) return null;

  // Calculate positions for food items in orbit (5 items evenly spaced)
  const orbitRadius = 109; // Distance from center
  const foodItemPositions = foodItems.map((_, index) => {
    const angle = (index * 360) / foodItems.length;
    const radian = (angle * Math.PI) / 180;
    const x = Math.cos(radian) * orbitRadius;
    const y = Math.sin(radian) * orbitRadius;
    return { x, y, angle };
  });

  return (
    <div
      className={`fixed inset-0 z-[9999] transition-opacity duration-400 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className="preloader-bg absolute inset-0 flex flex-col items-center justify-center"
        style={{
          background: "linear-gradient(165deg, var(--color-cream) 0%, var(--color-cream-dark) 50%, #FFE8DD 100%)",
          clipPath: "circle(150% at 50% 45%)",
        }}
      >
        {/* Background orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="bg-orb absolute top-[10%] left-[5%] w-[350px] h-[350px] md:w-[500px] md:h-[500px] bg-gradient-to-br from-[var(--color-primary)]/12 to-transparent rounded-full blur-[100px]"
            style={{
              translate: "none",
              rotate: "none",
              scale: "none",
              transform: "translate(0px, 0px)",
            }}
          />
          <div
            className="bg-orb absolute bottom-[10%] right-[5%] w-[300px] h-[300px] md:w-[450px] md:h-[450px] bg-gradient-to-br from-[var(--color-gold)]/15 to-transparent rounded-full blur-[100px]"
            style={{
              translate: "none",
              rotate: "none",
              scale: "none",
              transform: "translate(0px, 0px)",
            }}
          />
          {/* Dot pattern overlay */}
          <div
            className="absolute inset-0 opacity-[0.02]"
            style={{
              backgroundImage: "radial-gradient(circle at 1px 1px, var(--color-charcoal) 1px, transparent 0)",
              backgroundSize: "28px 28px",
            }}
          />
        </div>

        {/* Main content */}
        <div className="relative z-10 flex flex-col items-center">
          {/* Logo with orbiting food items */}
          <div className="relative mb-10" style={{ width: "340px", height: "340px" }}>
            {/* Orbit ring */}
            <div
              className="orbit-ring absolute inset-0"
              style={{
                width: "340px",
                height: "340px",
                transform: `translate3d(0px, 0px, 0px) rotate(${rotation}deg)`,
              }}
            >
              {foodItemPositions.map((pos, index) => (
                <div
                  key={index}
                  className="orbit-food-item absolute"
                  style={{
                    left: "50%",
                    top: "50%",
                    transform: `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`,
                    opacity: 1,
                  }}
                >
                  <div
                    className="orbit-food-inner w-[52px] h-[52px] md:w-[62px] md:h-[62px]"
                    style={{
                      transform: `translate3d(0px, 0px, 0px) rotate(${-rotation}deg)`,
                    }}
                  >
                    <img
                      alt=""
                      className="w-full h-full object-contain"
                      draggable={false}
                      src={foodItems[index].src}
                      style={{
                        filter: "drop-shadow(rgba(0, 0, 0, 0.18) 0px 8px 20px)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Logo in center */}
            <div
              className="logo-wrapper absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20"
              style={{ transform: "translate(-50%, -50%)" }}
            >
              <div
                className="logo-pulse relative w-28 h-28 md:w-32 md:h-32 flex items-center justify-center"
                style={{
                  transform: "translate3d(0px, 0px, 0px) scale(1.0425, 1.0425)",
                }}
              >
                <div className="absolute inset-[-20px] bg-gradient-radial from-[var(--color-primary)]/15 to-transparent rounded-full blur-2xl" />
                <div
                  className="absolute inset-0 bg-white rounded-full shadow-2xl"
                  style={{
                    boxShadow: "rgba(245, 16, 66, 0.25) 0px 20px 60px -10px",
                  }}
                />
                <Logo className="relative z-10 w-20 h-20 md:w-24 md:h-24 object-contain" />
              </div>
            </div>
          </div>

          {/* Brand name */}
          <div
            className="brand-name fade-element mb-2 pb-2"
            style={{
              transform: "translate(0px, 0px)",
              opacity: 1,
            }}
          >
            <h1
              className="font-display text-[3.2rem] md:text-[4.5rem] text-[var(--color-primary)] leading-none"
              style={{
                paddingBottom: "8px",
                marginBottom: "0px",
              }}
            >
              LocalCooks
            </h1>
          </div>

          {/* Tagline */}
          <p
            className="tagline fade-element font-mono text-[10px] md:text-[11px] text-[var(--color-charcoal-light)] uppercase tracking-[0.4em] mb-12"
            style={{
              transform: "translate(0px, 0px)",
              opacity: 1,
            }}
          >
            Homemade with Love
          </p>

          {/* Progress area */}
          <div
            className="progress-area fade-element w-52 md:w-64"
            style={{
              transform: "translate(0px, 0px)",
              opacity: 1,
            }}
          >
            <div className="relative h-[2px] bg-[var(--color-charcoal)]/8 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full progress-bar-gradient"
                style={{
                  width: `${progress}%`,
                  boxShadow: "0 0 15px var(--color-primary)",
                }}
              />
            </div>
            <div className="mt-4 flex justify-between items-center">
              <span className="font-mono text-[9px] md:text-[10px] text-[var(--color-charcoal-light)]/60 tracking-widest uppercase">
                Loading experience
              </span>
              <span className="font-mono text-sm md:text-base font-bold text-[var(--color-primary)] tabular-nums">
                {progress}%
              </span>
            </div>
          </div>
        </div>

        {/* Bottom text */}
        <div
          className="bottom-text absolute bottom-6 md:bottom-8 left-0 right-0 flex justify-center"
          style={{ opacity: 0.4 }}
        >
          <p className="font-body text-[9px] md:text-[10px] text-[var(--color-charcoal-light)] tracking-[0.2em]">
            Local Cooks • Local Company • Local Community
          </p>
        </div>
      </div>
    </div>
  );
}

