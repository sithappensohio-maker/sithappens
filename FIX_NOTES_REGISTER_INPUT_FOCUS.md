# Register input focus fix

## Problem
Register text and number fields lost focus after every keystroke, forcing the user to click the field again before typing the next character.

## Root cause
`FormInput` and `Select` were declared inside `RegisterTab`. Every state update recreated those component functions, so React treated each input as a new component, remounted it, and dropped keyboard focus.

## Fix
- Moved the register form input and select components to module scope in `frontend/src/screens/Staff.jsx`.
- Renamed them `RegisterFormInput` and `RegisterSelect` to make their purpose clear.
- Updated every register form to use the stable components.

## Register areas covered
- Opening drawer
- New sale
- Credit pack sale
- Client payment
- Refund
- Till adjustment
- Cash business expense
- Expenses and receipts
- Closeout
- Register reports

## Wider audit
- Parsed all 199 frontend JavaScript/JSX files successfully with Babel.
- Checked for other input, textarea, or select elements keyed by their current typed value: none found.
- Checked for other nested reusable components that could remount text fields: none found.
