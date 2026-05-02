cask "yames" do
  version "0.4.3"

  on_arm do
    url "https://github.com/turutupa/yames/releases/download/v#{version}/Yames_#{version}_aarch64.dmg"
    sha256 "4e7f4afc23217ed9ca668f53ff651717e324e126854124b87e12890d5f9d9f14"
  end

  on_intel do
    url "https://github.com/turutupa/yames/releases/download/v#{version}/Yames_#{version}_x64.dmg"
    sha256 "fca3abb74f9646a4e909d8720e88ee146fcd2ff82962d833d7ca3dad09dc4bb5"
  end

  name "Yames"
  desc "Yet Another Metronome Everyone Skips — musician-grade floating metronome"
  homepage "https://turutupa.github.io/yames/"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Yames.app"

  zap trash: [
    "~/Library/Application Support/com.yames.metronome",
    "~/Library/Caches/com.yames.metronome",
    "~/Library/Preferences/com.yames.metronome.plist",
  ]
end
