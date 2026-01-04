import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import GlobalAlertBar from "./GlobalAlertBar";

export const NavItem = ({ title, to }) => (
	<NavLink
		to={to}
		className={({ isActive }) =>
			`px-2 py-1 rounded text-sm font-semibold ${isActive ? "text-white bg-white/10" : "text-gray-300 hover:text-white hover:bg-white/5"}`
		}
	>
		{title}
	</NavLink>
);

export default function Navbar() {
	const navigate = useNavigate();
	const [mobileOpen, setMobileOpen] = useState(false);

	const handleLogout = () => {
		// remove stored token and redirect to login
		try {
			localStorage.removeItem("access_token");
		} catch (e) {
			// ignore
		}
		navigate("/login");
	};

	return (
		<>
			<nav className="fixed top-0 left-0 w-full bg-black/90 backdrop-blur-sm border-b border-white/10 px-4 md:px-6 py-3 flex justify-between items-center z-50">

				{/* LOGO */}
				<div className="text-white text-xl font-bold tracking-widest font-aura select-none">AURA</div>

				{/* DESKTOP MENU */}
				<div className="hidden md:flex items-center gap-4">
					<div className="flex gap-4 lg:gap-6">
						<NavItem title="MANUAL" to="/manual" />
						<NavItem title="PATROL" to="/patrol" />
						<NavItem title="ANALYTICS" to="/analytics" />
						<NavItem title="PEOPLE" to="/people" />
						<NavItem title="FACE RECOGNITION" to="/face-recognition" />
						<NavItem title="TELEGRAM" to="/telegram" />
					</div>

					<button
						onClick={handleLogout}
						className="text-sm bg-transparent border border-white/20 text-white px-3 py-1 rounded hover:bg-white/10"
					>
						LOGOUT
					</button>
				</div>

				{/* MOBILE TOGGLE */}
				<button
					className="md:hidden inline-flex items-center justify-center p-2 rounded-md border border-white/20 text-white hover:bg-white/10"
					aria-label="Toggle navigation"
					onClick={() => setMobileOpen((prev) => !prev)}
				>
					<span className="sr-only">Open main menu</span>
					<svg
						className="h-5 w-5"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						{mobileOpen ? (
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M6 18L18 6M6 6l12 12"
							/>
						) : (
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M4 6h16M4 12h16M4 18h16"
							/>
						)}
					</svg>
				</button>
			</nav>

			{/* MOBILE MENU PANEL */}
			{mobileOpen && (
				<div className="fixed top-[56px] left-0 w-full bg-black/95 border-b border-white/10 px-4 py-3 z-40 md:hidden">
					<div className="flex flex-col gap-2 mb-3">
						<NavItem title="MANUAL" to="/manual" />
						<NavItem title="PATROL" to="/patrol" />
						<NavItem title="ANALYTICS" to="/analytics" />
						<NavItem title="PEOPLE" to="/people" />
						<NavItem title="FACE RECOGNITION" to="/face-recognition" />
						<NavItem title="TELEGRAM" to="/telegram" />
					</div>
					<button
						onClick={() => {
							setMobileOpen(false);
							handleLogout();
						}}
						className="w-full text-sm bg-transparent border border-white/20 text-white px-3 py-2 rounded hover:bg-white/10"
					>
						LOGOUT
					</button>
				</div>
			)}
			<GlobalAlertBar />
		</>
	);
}

