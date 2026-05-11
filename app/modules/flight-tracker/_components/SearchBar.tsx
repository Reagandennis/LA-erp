import { Search } from 'lucide-react';
import { ChangeEvent } from 'react';

type SearchBarProps = {
  value: string;
  onChange: (val: string) => void;
  isLoading: boolean;
};

export function SearchBar({ value, onChange, isLoading }: SearchBarProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className="relative w-full max-w-md">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
        <Search className={`h-5 w-5 ${isLoading ? 'text-sky-400 animate-pulse' : 'text-slate-400'}`} />
      </div>
      <input
        type="text"
        className="block w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm placeholder-slate-400 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        placeholder="Search flight number (e.g., AFR990, BAW12)"
        value={value}
        onChange={handleChange}
      />
      {isLoading && (
        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500"></div>
        </div>
      )}
    </div>
  );
}
