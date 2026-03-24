import Link from 'next/link';

interface TicketNumberProps {
  id: string | number;
  href?: string;
}

export default function TicketNumber({ id, href }: TicketNumberProps) {
  const formatted = String(id).padStart(6, '0');
  const content = (
    <span
      style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: 12,
        fontWeight: 500,
        color: '#4F46E5',
        letterSpacing: '0.02em',
      }}
    >
      #{formatted}
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        style={{ textDecoration: 'none' }}
        className="hover:underline"
      >
        {content}
      </Link>
    );
  }

  return content;
}
