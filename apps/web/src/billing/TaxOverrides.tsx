import { indianStates } from '@gst/contracts';
import type { InvoiceDraftLine, Permission } from '@gst/contracts';

export function TaxOverrides({
  line,
  permissions,
  onChange,
}: {
  line: InvoiceDraftLine;
  permissions: Permission[];
  onChange: (v: Partial<InvoiceDraftLine>) => void;
}) {
  const tax = line.taxOverride;
  return (
    <>
      {permissions.includes('tax.override') && (
        <details>
          <summary>Tax classification override</summary>
          <p className="muted">
            Requires an already reviewed catalog classification. Record the
            replacement classification and its source.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(tax)}
              onChange={(e) =>
                onChange({
                  taxOverride: e.target.checked
                    ? {
                        hsnSac: '',
                        category: 'taxable',
                        gstPercent: '',
                        effectiveFrom: new Date(Date.now() + 330 * 60000)
                          .toISOString()
                          .slice(0, 10),
                        reason: '',
                        sourceReference: '',
                      }
                    : undefined,
                })
              }
            />
            Override this line’s classification
          </label>
          {tax && (
            <div className="form-grid">
              <label>
                Override HSN / SAC
                <input
                  required
                  value={tax.hsnSac}
                  maxLength={8}
                  inputMode="numeric"
                  onChange={(e) =>
                    onChange({
                      taxOverride: { ...tax, hsnSac: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                Override tax category
                <select
                  aria-label="Override tax category"
                  value={tax.category}
                  onChange={(e) =>
                    onChange({
                      taxOverride: {
                        ...tax,
                        category: e.target.value as typeof tax.category,
                        gstPercent:
                          e.target.value === 'taxable' ? tax.gstPercent : '0',
                      },
                    })
                  }
                >
                  <option value="taxable">Taxable</option>
                  <option value="nil">Nil-rated</option>
                  <option value="exempt">Exempt</option>
                </select>
              </label>
              <label>
                Override GST rate (%)
                <input
                  required
                  value={tax.gstPercent}
                  inputMode="decimal"
                  onChange={(e) =>
                    onChange({
                      taxOverride: { ...tax, gstPercent: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                Override effective from
                <input
                  type="date"
                  required
                  value={tax.effectiveFrom}
                  onChange={(e) =>
                    onChange({
                      taxOverride: { ...tax, effectiveFrom: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                Tax override reason
                <input
                  required
                  minLength={5}
                  maxLength={300}
                  value={tax.reason}
                  onChange={(e) =>
                    onChange({
                      taxOverride: { ...tax, reason: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                Tax override source
                <input
                  required
                  minLength={5}
                  maxLength={300}
                  value={tax.sourceReference}
                  onChange={(e) =>
                    onChange({
                      taxOverride: { ...tax, sourceReference: e.target.value },
                    })
                  }
                />
              </label>
            </div>
          )}
        </details>
      )}
      {permissions.includes('place_of_supply.override') && (
        <details>
          <summary>Place of supply override</summary>
          <label>
            Override state / territory
            <select
              aria-label="Override state / territory"
              value={line.placeOfSupplyOverride?.stateCode ?? ''}
              onChange={(e) =>
                onChange({
                  placeOfSupplyOverride: e.target.value
                    ? {
                        stateCode: e.target.value,
                        reason: line.placeOfSupplyOverride?.reason ?? '',
                      }
                    : undefined,
                })
              }
            >
              <option value="">Use guided supply facts</option>
              {indianStates.map(([code, name]) => (
                <option key={code} value={code}>
                  {code} · {name}
                </option>
              ))}
            </select>
          </label>
          {line.placeOfSupplyOverride && (
            <label>
              Place of supply override reason
              <input
                required
                minLength={5}
                maxLength={300}
                value={line.placeOfSupplyOverride.reason}
                onChange={(e) =>
                  onChange({
                    placeOfSupplyOverride: {
                      ...line.placeOfSupplyOverride!,
                      reason: e.target.value,
                    },
                  })
                }
              />
            </label>
          )}
        </details>
      )}
    </>
  );
}
