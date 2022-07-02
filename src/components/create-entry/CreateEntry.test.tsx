import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import sub from "date-fns/sub"
import { QueryClient, QueryClientProvider } from "react-query"
import { combineDateWithTime, formatTime } from "../../services/date"
import { TogglService } from "../../services/toggl/TogglService"
import { BookingStore, TogglStore } from "../../store"
import { getActionButton, getProjectSelector, getProjectSelectorValueElement, getStartTimeInput, getStopTimeInput, getTaskSelector } from "../../tests/selectors"
import { resetStores } from "../../tests/store"
import { inputValueAndBlur } from "../../tests/utils"
import { Client, Project, TimeEntry } from "../../types"
import { CreateEntry } from "./CreateEntry"

const stopTimeEntryMock = jest.spyOn(TogglService.prototype, "stopTimeEntry").mockImplementation(() => {
  return new Promise(function (resolve, reject) {
    resolve({} as TimeEntry)
  })
})

const updateTimeEntryMock = jest.spyOn(TogglService.prototype, "updateTimeEntry").mockImplementation(() => {
  return new Promise(function (resolve, reject) {
    resolve({} as TimeEntry)
  })
})

function renderWithClient() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateEntry />
    </QueryClientProvider>
  )
}

function setupWithRunningTimeEntry(now: Date, timeStart: string) {
  const clients = [{ id: 1, name: "Client A" }] as Client[]
  const projects = [
    { id: 1, name: "Project A", client: clients[0], color: "#ffffff" },
    { id: 2, name: "Project B", client: clients[0], color: "#ffffff" },
    { id: 3, name: "Project C", client: clients[0], color: "#ffffff" },
  ] as Project[]

  TogglStore.update((s) => {
    s.clients = clients
    s.projects = projects
  })

  BookingStore.update((s) => {
    s.day = now
    s.projectId = 2
    s.timeEntryDescription = "Running Entry 1"
    s.timeEntryId = 1234
    s.timeStart = timeStart
  })
}

beforeEach(() => {
  stopTimeEntryMock.mockReset()
})

afterEach(() => {
  resetStores()
})

test("Tabbing through subcomponents is in correct order", () => {
  renderWithClient()

  userEvent.tab()
  expect(getTaskSelector()).toHaveFocus()
  userEvent.tab()
  expect(within(getProjectSelector()).getByRole("combobox")).toHaveFocus()
})

test("stop time cannot be before start time", () => {
  renderWithClient()

  const start = getStartTimeInput()
  const stop = getStopTimeInput()

  inputValueAndBlur(start, "09:00")
  inputValueAndBlur(stop, "08:59")

  expect(start.getAttribute("class")?.split(" ")).not.toContain("ant-input-status-error")
  expect(stop.getAttribute("class")?.split(" ")).toContain("ant-input-status-error")
})

test("A.1 active entry fills all fields accordingly", () => {
  const now = new Date()
  const timeStart = formatTime(sub(now, { hours: 1 }))
  setupWithRunningTimeEntry(now, timeStart)

  const { container } = renderWithClient()

  expect(getTaskSelector()).toHaveValue("Running Entry 1")
  expect(getProjectSelectorValueElement(container)).toHaveTextContent("Project B | Client A")
  expect(getStartTimeInput()).toHaveValue(timeStart)
  expect(getStopTimeInput()).toHaveValue("")
  expect(getActionButton()).toHaveTextContent("Stop")
})

test("A.2 ui for stop entry behaves correctly", async () => {
  const now = new Date()
  const timeStart = formatTime(sub(now, { hours: 1 }))
  setupWithRunningTimeEntry(now, timeStart)

  const { container } = await renderWithClient()
  const task = getTaskSelector()
  const start = getStartTimeInput()
  const stop = getStopTimeInput()

  expect(task).toHaveValue("Running Entry 1")
  expect(task).toBeDisabled()
  expect(getProjectSelectorValueElement(container)).toHaveTextContent("Project B | Client A")
  expect(getProjectSelector().getAttribute("class")?.split(" ")).toContain("ant-select-disabled")
  expect(start).toHaveValue(timeStart)
  expect(stop).toHaveValue("")
  expect(getActionButton()).toHaveTextContent("Stop")

  // check start and end is alterable
  inputValueAndBlur(start, "09:00")
  expect(BookingStore.getRawState().timeStart).toBe("09:00")
  expect(BookingStore.getRawState().timeStop).toBeUndefined()

  inputValueAndBlur(stop, "10:00")
  expect(BookingStore.getRawState().timeStart).toBe("09:00")
  expect(BookingStore.getRawState().timeStop).toBe("10:00")
})

test("A.2 stop entry with set start time and no stop time works", async () => {
  const now = new Date()
  const timeStart = formatTime(sub(now, { hours: 1 }))
  setupWithRunningTimeEntry(now, timeStart)

  await renderWithClient()
  inputValueAndBlur(getStartTimeInput(), "09:00")

  fireEvent.click(getActionButton())

  const notificiation = await screen.findByText("Entry updated.")
  expect(notificiation).toBeVisible()

  expect(stopTimeEntryMock).toBeCalledTimes(1)
  expect(stopTimeEntryMock).toBeCalledWith(1234)
})

// TODO A.2 stop with set start and stop sends proper request
test("A.2 stop entry with set start time and set stop time works", async () => {
  const now = new Date()
  const timeStart = formatTime(sub(now, { hours: 1 }))
  setupWithRunningTimeEntry(now, timeStart)

  await renderWithClient()
  inputValueAndBlur(getStartTimeInput(), "09:00")
  inputValueAndBlur(getStopTimeInput(), "10:00")

  fireEvent.click(getActionButton())

  const notificiation = await screen.findByText("Entry updated.")
  expect(notificiation).toBeVisible()
  expect(updateTimeEntryMock).toBeCalledTimes(1)
  expect(updateTimeEntryMock).toBeCalledWith({
    day: now,
    projectId: 2,
    timeEntryDescription: "Running Entry 1",
    timeEntryId: 1234,
    timeStart: combineDateWithTime(now, "09:00"),
    timeStop: combineDateWithTime(now, "10:00"),
  })
})
