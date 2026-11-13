import { useLayoutEffect, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { formatAmountInput, normalizeAmountInput } from '../utils/money';

export function AmountInput({ value = '', onChangeText, onSelectionChange, onKeyPress, ...props }) {
	const inputRef = useRef(null);
	const selectionRef = useRef(null);
	const keySelectionRef = useRef(null);
	const caretRef = useRef(null);
	const [editCount, setEditCount] = useState(0);
	const displayValue = formatAmountInput(value);

	useLayoutEffect(() => {
		if (caretRef.current === null) return;
		const cursor = Math.min(caretRef.current, displayValue.length);
		inputRef.current?.setNativeProps({ selection: { start: cursor, end: cursor } });
		selectionRef.current = { start: cursor, end: cursor };
		caretRef.current = null;
	}, [displayValue, editCount]);

	function change(text) {
		const previous = keySelectionRef.current ??
			selectionRef.current ?? { start: displayValue.length, end: displayValue.length };
		keySelectionRef.current = null;
		const delta = text.length - displayValue.length;
		const inserted = text.length - (displayValue.length - (previous.end - previous.start));
		const prefixText = displayValue.slice(0, previous.start);
		const suffixText = displayValue.slice(previous.end);
		const backspace = displayValue.slice(0, Math.max(0, previous.start + delta)) + suffixText;
		const forward = prefixText + displayValue.slice(previous.end - delta);
		const singleEdit =
			(inserted >= 0 &&
				inserted <= 1 &&
				text ===
					prefixText +
						text.slice(previous.start, previous.start + inserted) +
						suffixText) ||
			(delta < 0 &&
				previous.start === previous.end &&
				(text === backspace || text === forward));
		if (singleEdit && text === `${prefixText}.${suffixText}`) {
			// Some phone keyboards show a dot instead of a comma on the decimal key.
			text = `${prefixText},${suffixText}`;
		}
		const next = normalizeAmountInput(text, singleEdit);
		if (next === null) {
			caretRef.current = previous.start;
		} else {
			let cursor = previous.end + delta;
			let forwardDelete = false;
			if (delta < 0 && previous.start === previous.end) {
				if (text !== backspace) {
					cursor = previous.start;
					forwardDelete = text === forward;
				}
			}
			if (!text.includes(',') && next.includes(',')) text = text.replace('.', ',');
			const prefix = text.slice(0, Math.max(0, cursor)).replace(/\./g, '').trim();
			const rawWhole = text.trim().replace(/\./g, '').split(',')[0];
			const removedZeros = rawWhole.length - next.split(',')[0].length;
			let prefixLength = prefix.length;
			if (removedZeros > 0)
				prefixLength -= Math.min(
					removedZeros,
					prefix.replace('-', '').split(',')[0].length,
				);
			else if (removedZeros < 0 && prefix.includes(',')) prefixLength -= removedZeros;
			const formatted = formatAmountInput(next);
			let position = 0;
			let characters = 0;
			// Keep the caret next to the same digits when grouping dots change.
			while (position < formatted.length && characters < prefixLength) {
				if (formatted[position] !== '.') characters++;
				position++;
			}
			if (forwardDelete && next === value && formatted[position] === '.') position++;
			caretRef.current = position;
			onChangeText(next);
		}
		setEditCount((count) => count + 1);
	}

	return (
		<TextInput
			keyboardType="decimal-pad"
			selectTextOnFocus
			{...props}
			ref={inputRef}
			value={displayValue}
			onChangeText={change}
			onSelectionChange={(event) => {
				selectionRef.current = event.nativeEvent.selection;
				onSelectionChange?.(event);
			}}
			onKeyPress={(event) => {
				if (
					event.nativeEvent.key.length === 1 ||
					['Backspace', 'Delete'].includes(event.nativeEvent.key)
				)
					keySelectionRef.current = selectionRef.current ?? {
						start: displayValue.length,
						end: displayValue.length,
					};
				onKeyPress?.(event);
			}}
		/>
	);
}
