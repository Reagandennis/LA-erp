import { type Block, type InlineRun, parseRichText } from '@/lib/rich-text';

/**
 * Shows text written with the rich-text editor: bold, italic, bulleted and
 * numbered lists. Built from React elements only, never from HTML, so a
 * handover can't carry markup into the page.
 */
export default function RichText({ value, className = '' }: { value: string | null | undefined; className?: string }) {
  if (!value) return null;
  const blocks = parseRichText(value);
  return (
    <div className={`space-y-2 ${className}`}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.type === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul';
    return (
      <Tag className={`space-y-0.5 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-gray-400`}>
        {block.items.map((runs, i) => (
          <li key={i}>
            <Runs runs={runs} />
          </li>
        ))}
      </Tag>
    );
  }
  return (
    <p>
      {block.lines.map((runs, i) => (
        <span key={i}>
          {i > 0 && <br />}
          <Runs runs={runs} />
        </span>
      ))}
    </p>
  );
}

function Runs({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((run, i) => {
        let node: React.ReactNode = run.text;
        if (run.italic) node = <em key={i}>{node}</em>;
        if (run.bold) node = <strong key={i} className="font-semibold text-gray-900">{node}</strong>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}
