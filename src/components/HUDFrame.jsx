import React from 'react';

export default function HUDFrame() {
  return (
    <>
      <div className="hud-corner hud-corner--tl" />
      <div className="hud-corner hud-corner--tr" />
      <div className="hud-corner hud-corner--bl" />
      <div className="hud-corner hud-corner--br" />
      <div className="hud-scanlines" aria-hidden="true" />
      <div className="hud-vignette" aria-hidden="true" />
    </>
  );
}
