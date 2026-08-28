module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.js", "**/*.test.jsx"],
  transform: {
    "^.+\\.[jt]sx?$": ["babel-jest", {
      presets: [
        ["@babel/preset-env", { targets: { node: "current" } }],
        ["@babel/preset-react", { runtime: "automatic" }],
      ],
    }],
  },
  // FullCalendar (imported by Schedule.jsx via App.js) pulls in preact's
  // ESM-only dist build; let babel-jest transform those packages instead of
  // the default "ignore all of node_modules" so any suite importing ../App
  // can parse.
  transformIgnorePatterns: [
    "/node_modules/(?!(preact|@fullcalendar)([/\\\\]|$))",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.(css|less|scss|sass)$": "<rootDir>/src/test/styleMock.js",
    "\\.(gif|ttf|eot|svg|png|jpg|jpeg|webp)$": "<rootDir>/src/test/fileMock.js",
  },
  clearMocks: false,
  restoreMocks: false,
};
