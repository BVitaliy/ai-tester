import React from "react"

// Simple SVG icon components used throughout the Jack QA extension.
// Each icon accepts standard SVG props so that it can be styled via
// CSS (e.g. setting the width/height and color via currentColor).

export const CameraIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  ...props
}) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
    {/* Camera body */}
    <rect x={3} y={7} width={18} height={14} rx={2} ry={2} />
    {/* Top bar with flash bump */}
    <path d="M8 7l2-3h4l2 3" />
    {/* Lens */}
    <circle cx={12} cy={14} r={3.5} />
  </svg>
)

export const VideoIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  ...props
}) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
    {/* Camera body */}
    <rect x={3} y={7} width={13} height={10} rx={2} ry={2} />
    {/* Camcorder projection */}
    <polygon points="18,9 22,12 18,15" fill="currentColor" />
  </svg>
)

export const RecordActionsIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  ...props
}) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
    {/* Arrow pointer approximated for action recording */}
    <path d="M4 3l7 9H8l4 9l3-1.5l-4-9H15z" />
  </svg>
)

export const CrosshairIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  ...props
}) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
    {/* Outer circle */}
    <circle cx={12} cy={12} r={7} />
    {/* Cross lines */}
    <line x1={12} y1={2} x2={12} y2={6} />
    <line x1={12} y1={18} x2={12} y2={22} />
    <line x1={2} y1={12} x2={6} y2={12} />
    <line x1={18} y1={12} x2={22} y2={12} />
  </svg>
)

export const LightBulbIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  ...props
}) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
    {/* Bulb outline */}
    <path d="M9 2a7 7 0 0 1 6 12v3H9v-3A7 7 0 0 1 9 2z" />
    {/* Base */}
    <rect x={9} y={17} width={6} height={2} fill="currentColor" />
  </svg>
)

export const SettingsIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({
  ...props
}) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
    {/* Simplified gear shape */}
    <path d="M12 2l1 3l3 1l-1 3l1 3l-3 1l-1 3l-3-1l-3-1l1-3l-1-3l3-1l1-3z" />
    <circle cx={12} cy={12} r={2.5} fill="currentColor" />
  </svg>
)