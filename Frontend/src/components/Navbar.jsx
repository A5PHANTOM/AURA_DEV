import React from "react";
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
			<nav className="fixed top-0 left-0 w-full bg-black/90 backdrop-blur-sm border-b border-white/10 px-6 py-4 flex justify-between items-center z-50">

				{/* LOGO */}
				<div className="text-white text-xl font-bold tracking-widest font-aura select-none">AURA</div>

				{/* MENU + ACTIONS */}
				<div className="flex items-center gap-4">
					<div className="flex gap-6">
						<NavItem title="MANUAL" to="/manual" />
						<NavItem title="PATROL" to="/patrol" />
						<NavItem title="ANALYTICS" to="/analytics" />
						<NavItem title="PEOPLE" to="/people" />
						<NavItem title="FACE RECOGNITION" to="/face-recognition" />
					</div>

					<button
						onClick={handleLogout}
						className="text-sm bg-transparent border border-white/20 text-white px-3 py-1 rounded hover:bg-white/10"
					>
						LOGOUT
					</button>
				</div>

			</nav>
			<GlobalAlertBar />
		</>
	);
}

