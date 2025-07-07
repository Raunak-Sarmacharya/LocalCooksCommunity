import { cn } from '@/lib/utils';
import React from 'react';

interface Column {
  key: string;
  label: string;
  render?: (value: any, row: any) => React.ReactNode;
  className?: string;
  mobileLabel?: string; // Custom label for mobile display
}

interface ResponsiveTableProps {
  columns: Column[];
  data: any[];
  className?: string;
  mobileBreakpoint?: string;
  keyField?: string;
  emptyMessage?: string;
  mobileCardClassName?: string;
}

export const ResponsiveTable: React.FC<ResponsiveTableProps> = ({
  columns,
  data,
  className = '',
  mobileBreakpoint = 'md',
  keyField = 'id',
  emptyMessage = 'No data available',
  mobileCardClassName = ''
}) => {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={cn('responsive-table-container', className)}>
      {/* Desktop Table View */}
      <div className={`hidden ${mobileBreakpoint}:block`}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={cn(
                      'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider',
                      column.className
                    )}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.map((row, index) => (
                <tr key={row[keyField] || index} className="hover:bg-gray-50">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-6 py-4 whitespace-nowrap text-sm text-gray-900',
                        column.className
                      )}
                    >
                      {column.render
                        ? column.render(row[column.key], row)
                        : row[column.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className={`${mobileBreakpoint}:hidden space-y-4`}>
        {data.map((row, index) => (
          <div
            key={row[keyField] || index}
            className={cn(
              'bg-white rounded-lg border border-gray-200 p-4 shadow-sm',
              mobileCardClassName
            )}
          >
            {columns.map((column) => {
              const value = column.render
                ? column.render(row[column.key], row)
                : row[column.key];
              
              // Skip empty values
              if (value === null || value === undefined || value === '') {
                return null;
              }

              return (
                <div key={column.key} className="flex justify-between items-start mb-2 last:mb-0">
                  <span className="text-sm font-medium text-gray-600 mr-2 flex-shrink-0">
                    {column.mobileLabel || column.label}:
                  </span>
                  <span className="text-sm text-gray-900 text-right flex-1">
                    {value}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

// Utility component for simple data tables
export const SimpleResponsiveTable: React.FC<{
  headers: string[];
  rows: (string | React.ReactNode)[][];
  className?: string;
}> = ({ headers, rows, className = '' }) => {
  const columns: Column[] = headers.map((header, index) => ({
    key: index.toString(),
    label: header,
    render: (_, row) => row[index]
  }));

  const data = rows.map((row, index) => {
    const obj: any = { id: index };
    row.forEach((cell, cellIndex) => {
      obj[cellIndex.toString()] = cell;
    });
    return obj;
  });

  return (
    <ResponsiveTable
      columns={columns}
      data={data}
      className={className}
      keyField="id"
    />
  );
};

export default ResponsiveTable; 