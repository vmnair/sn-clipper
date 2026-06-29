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
echo -e "${GREEN}Supernote connected: $DEVICE_NAME${NC}"

# Remove previous plugin file from MyStyle folder on the device
echo -e "${BLUE}Removing old SnClipper.snplg from Supernote/MyStyle...${NC}"
adb shell rm -f /sdcard/MyStyle/SnClipper.snplg

# Push the new plugin package
echo -e "${BLUE}Pushing build/outputs/SnClipper.snplg to Supernote/MyStyle...${NC}"
adb push build/outputs/SnClipper.snplg /sdcard/MyStyle/

echo -e "${GREEN}Plugin successfully copied to device!${NC}"
echo -e "${BLUE}On your Supernote, please open Settings -> My Style -> Sideloading and tap 'Install' or 'Update' to complete.${NC}"
