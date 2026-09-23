#!/usr/bin/env sh
set -eu

MIGRATION_DIR="backend/pb_migrations"
SRC_MIGRATION_DIR="backend/src/migrations"

if [ ! -d "$MIGRATION_DIR" ]; then
	echo "Migration directory not found: $MIGRATION_DIR" >&2
	exit 1
fi

if ! command -v rg >/dev/null 2>&1; then
	echo "ripgrep (rg) is required for migration checks." >&2
	exit 1
fi

status=0

for file in "$MIGRATION_DIR"/*.js; do
	[ -e "$file" ] || continue

	has_direct_loop=0
	has_remove=0

	if rg -q 'for\s*\(\s*const\s+field\s+of\s+[^)]*\.schema\.fields\(\)\s*\)' "$file"; then
		has_direct_loop=1
	fi

	if rg -q 'schema\.removeField\(field\.id\)' "$file"; then
		has_remove=1
	fi

	if [ "$has_direct_loop" -eq 1 ] && [ "$has_remove" -eq 1 ]; then
		echo "Unsafe migration pattern in $file" >&2
		echo "  Avoid removeField(field.id) while iterating collection.schema.fields()." >&2
		echo "  Use a snapshot list (e.g. existingFields = collection.schema.fields().filter(...)) first." >&2
		status=1
	fi
	
	if rg -q '\bcore\.' "$file"; then
		echo "Unsafe reference in $file" >&2
		echo "  Do not use 'core.' in JS migrations (e.g. core.Field). Use 'Field' directly as it is globally injected." >&2
		status=1
	fi
done

if [ -d "$SRC_MIGRATION_DIR" ]; then
	for file in "$SRC_MIGRATION_DIR"/*.ts; do
		[ -e "$file" ] || continue
		
		if rg -q '@ts-nocheck' "$file"; then
			echo "Unsafe typing in $file" >&2
			echo "  Do not use // @ts-nocheck in migrations. It bypasses checking for invalid globals like core.Field." >&2
			status=1
		fi
		
		if rg -q '\bcore\.' "$file"; then
			echo "Unsafe reference in $file" >&2
			echo "  Do not use 'core.' in TS migrations (e.g. core.Field). Use 'Field' directly." >&2
			status=1
		fi
	done
fi

if [ "$status" -ne 0 ]; then
	echo "PocketBase migration check failed." >&2
	exit "$status"
fi

echo "PocketBase migration check passed."
