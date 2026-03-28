'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

type TagOption = {
  id?: string;
  name: string;
  color?: string | null;
};

type Props = {
  options: TagOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
};

const normalize = (value: string) => value.trim().toLowerCase();

const chipStyle = (color?: string | null) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 9px',
  borderRadius: 999,
  background: color ? `${color}18` : '#EEF2FF',
  color: color || '#4F46E5',
  border: `1px solid ${color ? `${color}35` : '#C7D2FE'}`,
  fontSize: 11,
  fontWeight: 700 as const,
  lineHeight: 1,
});

export function TagMultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Selecione tags',
  disabled,
  emptyText = 'Nenhuma tag cadastrada',
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectedOptions = useMemo(
    () => value.map((name) => options.find((opt) => normalize(opt.name) === normalize(name)) || { name }).filter(Boolean),
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const term = normalize(search);
    if (!term) return options;
    return options.filter((option) => normalize(option.name).includes(term));
  }, [options, search]);

  const toggle = (name: string) => {
    const exists = value.some((item) => normalize(item) === normalize(name));
    if (exists) onChange(value.filter((item) => normalize(item) !== normalize(name)));
    else onChange([...value, name]);
  };

  return (
    <div style={{ position: 'relative' }} ref={boxRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        style={{
          width: '100%',
          minHeight: 42,
          padding: '8px 12px',
          background: disabled ? '#F1F5F9' : '#F8FAFC',
          border: `1.5px solid ${open ? '#6366F1' : '#E2E8F0'}`,
          borderRadius: 10,
          color: '#0F172A',
          fontSize: 13,
          outline: 'none',
          boxSizing: 'border-box',
          transition: 'all 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1, minWidth: 0 }}>
          {selectedOptions.length > 0 ? (
            selectedOptions.map((tag) => (
              <span key={tag.name} style={chipStyle(tag.color)}>
                <span>{tag.name}</span>
                {!disabled && (
                  <span
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(tag.name);
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center' }}
                  >
                    <X size={12} />
                  </span>
                )}
              </span>
            ))
          ) : (
            <span style={{ color: '#94A3B8' }}>{placeholder}</span>
          )}
        </div>
        <ChevronDown size={15} color="#94A3B8" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .15s' }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: '#fff',
            border: '1px solid #E2E8F0',
            borderRadius: 12,
            boxShadow: '0 18px 40px rgba(15,23,42,0.14)',
            zIndex: 40,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: 10, borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} color="#94A3B8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar tag..."
                style={{
                  width: '100%',
                  height: 36,
                  borderRadius: 9,
                  border: '1px solid #E2E8F0',
                  padding: '0 12px 0 32px',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ maxHeight: 220, overflowY: 'auto', padding: 8 }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 12, color: '#94A3B8' }}>{emptyText}</div>
            ) : (
              filteredOptions.map((option) => {
                const checked = value.some((item) => normalize(item) === normalize(option.name));
                return (
                  <button
                    key={option.id || option.name}
                    type="button"
                    onClick={() => toggle(option.name)}
                    style={{
                      width: '100%',
                      border: 'none',
                      background: checked ? '#F8FAFC' : 'transparent',
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: option.color || '#6366F1', flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: '#0F172A', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.name}</span>
                    </div>
                    {checked && <Check size={15} color={option.color || '#4F46E5'} />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
