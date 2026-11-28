import React from 'react';

/**
 * Approved Quran hero banner — full width, no overlaid text.
 */
export default function HeroBanner() {
  return (
    <div className="hero-banner" aria-label="Quran Reel Generator banner">
      <img
        src="/assets/banner.png?v=24"
        alt="The Holy Quran with glowing lantern, pearl tasbih, and Asma al-Husna plaque"
        className="hero-banner-img"
      />
    </div>
  );
}
