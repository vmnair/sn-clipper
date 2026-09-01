#!/bin/bash
# sn-clipper/deploy.sh
set -e

# Colors for outputs
GREEN='\033[32m'
BLUE='\033[34m'
YELLOW='\033[33m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting Clipper build process...${NC}"

# 1. Build the plugin package first
echo -e "${BLUE}Building plugin package...${NC}"
./buildPlugin.sh

# 2. Check if a device is connected via ADB
if ! adb get-state &>/dev/null; then
  echo -e "${YELLOW}Notice: No Supernote device detected via ADB.${NC}"
  echo -e "${GREEN}Build succeeded! Your updated plugin file is ready for Wi-Fi sync at:${NC}"
  echo -e "${GREEN}  build/outputs/SnClipper.snplg${NC}"
  exit 0
fi

# 3. If connected, proceed with ADB push
DEVICE_NAME=$(adb devices | grep -v "List" | head -n 1 | awk '{print $1}')
# printf (not echo -e) so an unexpected device serial isn't interpreted as escapes.
printf '%bSupernote connected: %s%b\n' "$GREEN" "$DEVICE_NAME" "$NC"

# Push the new plugin package
echo -e "${BLUE}Pushing build/outputs/SnClipper.snplg to Supernote/MyStyle...${NC}"
adb shell rm -f /sdcard/Supernote/MyStyle/SnClipper.snplg /sdcard/MyStyle/SnClipper.snplg
adb push build/outputs/SnClipper.snplg /sdcard/Supernote/MyStyle/SnClipper.snplg
adb push build/outputs/SnClipper.snplg /sdcard/MyStyle/SnClipper.snplg
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Supernote/MyStyle/SnClipper.snplg >/dev/null 2>&1 || true

echo -e "${GREEN}Plugin successfully copied to device!${NC}"
echo -e "${BLUE}On your Supernote, please open Settings -> My Style -> Sideloading and tap 'Install' or 'Update' to complete.${NC}"
