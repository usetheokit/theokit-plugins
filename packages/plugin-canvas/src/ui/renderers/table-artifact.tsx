import type { ArtifactRendererProps } from './types.js'

/**
 * TableArtifact — a `<table>` with a `<thead>` from `columns`. Cells are
 * plain text and are rendered as React text nodes, never as HTML.
 */
export function TableArtifact({ artifact }: ArtifactRendererProps<'table'>) {
  return (
    <div data-testid="table-artifact" className="overflow-x-auto p-3">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {artifact.columns.map((c, i) => (
              <th key={i} scope="col" className="border-b px-2 py-1 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {artifact.rows.map((row, r) => (
            <tr key={r}>
              {row.map((c, i) => (
                <td key={i} className="border-b px-2 py-1">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
