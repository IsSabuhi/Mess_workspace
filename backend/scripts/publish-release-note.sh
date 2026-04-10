#!/bin/sh
set -eu

if [ "${RELEASE_NOTES_ENABLED:-1}" != "1" ]; then
  echo "Release notes publishing is disabled (RELEASE_NOTES_ENABLED != 1)"
  exit 0
fi

: "${API_BASE_URL:?API_BASE_URL is required, e.g. https://app.example.com}"
: "${RELEASE_NOTES_TOKEN:?RELEASE_NOTES_TOKEN is required}"

VERSION="${RELEASE_VERSION:-${CI_COMMIT_TAG:-${CI_COMMIT_SHORT_SHA:-}}}"
if [ -z "${VERSION}" ]; then
  VERSION="$(date +%Y.%m.%d-%H%M)"
fi

TITLE="${RELEASE_TITLE:-Релиз ${VERSION}}"
BODY="${RELEASE_BODY:-Опубликовано из CI/CD pipeline.}"

echo "Publishing release note: version=${VERSION}"
curl --fail --show-error --silent \
  -X POST "${API_BASE_URL%/}/api/v1/release-notes/publish" \
  -H "Authorization: Bearer ${RELEASE_NOTES_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": \"${VERSION}\",
    \"title\": \"${TITLE}\",
    \"body\": \"${BODY}\"
  }"
echo
echo "Release note publish request sent."
