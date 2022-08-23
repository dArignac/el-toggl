import axios, { AxiosInstance } from "axios"
import add from "date-fns/add"
import { config } from "../../config"
import { isDev } from "../../helpers"
import { TimeBookingStore, TogglStore } from "../../store"
import { Client, Project, TimeEntry, User, Workspace } from "../../types"
import { formatDate, formatTime, sortStartStopables } from "../date"
import { TogglClient, TogglProject, TogglTimeEntry, TogglUser } from "./types"

export class TogglService {
  private static instance: TogglService
  private ax: AxiosInstance
  private _token = ""

  private constructor(token: string) {
    this.token = token
    this.ax = axios.create({
      baseURL: "https://api.track.toggl.com/api/v9",
    })
  }

  private getAuth() {
    return {
      auth: {
        username: this.token,
        password: "api_token",
      },
    }
  }

  get token() {
    return this._token
  }

  public set token(token: string) {
    this._token = token
  }

  /**
   * Helper to delay the actual network calls. Used for testing loading indicators etc.
   * @param ms delay in milliseconds
   * @returns Promise
   */
  private sleep(ms = 2000): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Fetches the user information.
   * @returns User
   */
  public async fetchUser(): Promise<User> {
    if (isDev() && config.development.networkDelays.fetchUser > 0) {
      await this.sleep(config.development.networkDelays.fetchUser)
    }

    // fetch data
    let { data } = await this.ax.get<TogglUser>("/me", {
      ...this.getAuth(),
    })

    const user: User = {
      defaultWorkspaceId: data.default_workspace_id,
      email: data.email,
      id: data.id,
    }

    // update store
    TogglStore.update((s) => {
      // s.tasks = tasks
      s.user = user
    })

    return user
  }

  public async fetchClients(workspaceId: number): Promise<Client[]> {
    let { data } = await this.ax.get<TogglClient[]>(`/workspaces/${workspaceId}/clients`, { ...this.getAuth() })

    if (data != null) {
      const clients = data.map((client) => {
        return {
          id: client.id,
          name: client.name,
        } as Client
      })

      TogglStore.update((s) => {
        s.clients = clients
      })

      return clients
    }

    return []
  }

  public async fetchProjects(workspaceId: number): Promise<Project[]> {
    let { data } = await this.ax.get<TogglProject[]>(`/workspaces/${workspaceId}/projects`, { ...this.getAuth() })

    const clients = TogglStore.getRawState().clients

    if (data != null) {
      const projects = data
        .map((project) => {
          const ws: Workspace = {
            id: project.workspace_id,
          }
          return {
            client: clients.find((client) => client.id === project.client_id),
            color: project.color,
            id: project.id,
            name: project.name,
            workspace: ws,
          } as Project
        })
        .sort(function (p1, p2) {
          return p1.name.localeCompare(p2.name)
        })

      TogglStore.update((s) => {
        s.projects = projects
      })
    }

    return []
  }

  public async fetchActiveTimeEntry(): Promise<TimeEntry | null> {
    let { data } = await this.ax.get<TogglTimeEntry>("/me/time_entries/current", {
      ...this.getAuth(),
    })

    if (data === null) {
      return null
    } else {
      const entry = this.mapTimeEntry(data, TogglStore.getRawState().projects)

      TimeBookingStore.update((s) => {
        s.day = entry.start
        s.description = entry.description
        s.start = formatTime(entry.start)
        s.entry = entry
        s.projectId = entry.project.id
      })

      return entry
    }
  }

  /**
   * Fetches the time entries of the given day for the user.
   * @param day the day to use
   * @returns list of TimeEntry
   */
  public async fetchTimeEntriesOfDay(day: Date): Promise<TimeEntry[]> {
    if (isDev() && config.development.networkDelays.fetchEntries > 0) {
      await this.sleep(config.development.networkDelays.fetchEntries)
    }

    // API takes a date and assumes the time is 00:00:00
    // thus querying a day we need <day> as start date and <day+1> as end date
    const { data } = await this.ax.get<TogglTimeEntry[]>("/me/time_entries", {
      ...this.getAuth(),
      params: { start_date: formatDate(day), end_date: formatDate(add(day, { days: 1 })) },
    })

    return data.map((entry: TogglTimeEntry) => this.mapTimeEntry(entry, TogglStore.getRawState().projects)).sort(sortStartStopables)
  }

  public async updateTimeEntry(entry: TimeEntry): Promise<TimeEntry | null> {
    try {
      const { data } = await this.ax.put<TogglTimeEntry>(`/workspaces/${entry.project.workspace.id}/time_entries/${entry.id}`, entry, { ...this.getAuth() })

      if (data !== null) {
        return this.mapTimeEntry(data, TogglStore.getRawState().projects)
      }
    } catch {}
    return null
  }

  private mapTimeEntry(entry: TogglTimeEntry, projects: Project[]): TimeEntry {
    const project = projects.find((project) => project.id === entry.project_id)
    const item = {
      description: entry.description,
      duration: entry.duration,
      id: entry.id,
      project,
      start: new Date(entry.start),
    } as TimeEntry
    if ("stop" in entry) {
      item.stop = new Date(entry.stop!!)
    }
    return item
  }

  public static getInstance(token: string): TogglService {
    if (!TogglService.instance) {
      TogglService.instance = new TogglService(token)
    } else {
      TogglService.instance.token = token
    }
    return TogglService.instance
  }
}
