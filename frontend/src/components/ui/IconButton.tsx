import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  size?: 'sm' | 'md';
  variant?: 'default' | 'ghost' | 'danger';
}

export default function IconButton({
  icon,
  label,
  size = 'md',
  variant = 'default',
  style,
  ...props
}: IconButtonProps) {
  const px = size === 'sm' ? 26 : 30;

  const variantStyles: Record<string, React.CSSProperties> = {
    default: {
      background: '#fff',
      border: '1px solid rgba(0,0,0,0.10)',
      color: '#475569',
    },
    ghost: {
      background: 'transparent',
      border: '1px solid transparent',
      color: '#94A3B8',
    },
    danger: {
      background: '#FEF2F2',
      border: '1px solid #FECACA',
      color: '#EF4444',
    },
  };

  return (
    <button
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px,
        height: px,
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'background 0.1s, color 0.1s',
        padding: 0,
        flexShrink: 0,
        ...variantStyles[variant],
        ...style,
      }}
      {...props}
    >
      {icon}
    </button>
  );
}
